using System.Text.Json;
using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Export;
using Cyberjet.Api.Services.Parsing;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

[ApiController]
[Route("api/questionnaires")]
public sealed class QuestionnairesController(
    AppDbContext db,
    AuditService audit,
    SearchEngine engine,
    StoragePaths paths,
    ExcelExporter exporter) : ControllerBase
{
    private const long MaxUploadBytes = 40 * 1024 * 1024;

    [HttpGet]
    public async Task<List<QuestionnaireListItem>> List(
        [FromQuery] int? clientId, CancellationToken ct)
    {
        var query = db.Questionnaires.AsNoTracking();
        if (clientId is not null) query = query.Where(q => q.ClientId == clientId);

        return await query
            .OrderByDescending(q => q.UpdatedAt)
            .Select(q => new QuestionnaireListItem(
                q.Id, q.ClientId, q.Client.Name, q.Name, q.OriginalFilename, q.FileType,
                q.Status, q.CreatedAt, q.UpdatedAt,
                q.Questions.Count,
                q.Questions.Count(x => x.Status == "validated"),
                q.Questions.Count(x => x.Status == "na"),
                q.Questions.Count(x =>
                    (x.FinalAnswer ?? x.SuggestedAnswer ?? "").Trim() != "")))
            .ToListAsync(ct);
    }

    [HttpPost("upload")]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<ActionResult<QuestionnaireDetailResponse>> Upload(
        [FromForm] int clientId,
        [FromForm] string? name,
        IFormFile file,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            throw ApiException.BadRequest("Aucun fichier reçu.");

        var filename = Path.GetFileName(file.FileName);
        if (string.IsNullOrWhiteSpace(filename)) filename = "questionnaire";

        var fileType = ParseVocabulary.DetectFileType(filename);
        if (!QuestionnaireParser.SupportedTypes.Contains(fileType))
            throw new ApiException(415,
                $"Format « {fileType} » non pris en charge. "
                + "Formats acceptés : Excel, Word, PDF, CSV.");

        if (!await db.Clients.AnyAsync(c => c.Id == clientId, ct))
            throw ApiException.NotFound("Client introuvable.");

        // Nom de stockage préfixé d'un GUID : deux clients peuvent envoyer un
        // « questionnaire.xlsx », et le nom d'origine reste lisible dans le dossier.
        var stored = Path.Combine(paths.UploadDirectory, $"{Guid.NewGuid():N}_{filename}");
        await using (var target = System.IO.File.Create(stored))
            await file.CopyToAsync(target, ct);

        // L'extension se renomme en un clic ; les premiers octets, beaucoup
        // moins facilement. Avant de passer le fichier à ClosedXML/OpenXml/
        // PdfPig, on vérifie qu'il est bien ce que son nom prétend.
        if (!FileSignature.Matches(stored, fileType))
        {
            StoragePaths.TryDelete(stored);
            await audit.RecordAsync("questionnaire.rejected", outcome: "failure",
                actor: HttpContext.CurrentUser(), detail:
                    $"Fichier {filename} rejeté : contenu incohérent avec l'extension "
                  + $"« {fileType} »", ct: ct);
            throw ApiException.BadRequest(
                "Le contenu du fichier ne correspond pas à son extension.");
        }

        ParseResult parsed;
        try
        {
            parsed = QuestionnaireParser.Parse(stored, filename);
        }
        catch (Exception exception) when (exception is not ApiException)
        {
            StoragePaths.TryDelete(stored);
            throw ApiException.Unprocessable($"Lecture impossible : {exception.Message}");
        }

        var label = string.IsNullOrWhiteSpace(name)
            ? Path.GetFileNameWithoutExtension(filename) : name.Trim();

        var id = await InsertAsync(clientId, label, filename, stored, parsed, ct);

        await audit.RecordAsync("questionnaire.imported", actor: HttpContext.CurrentUser(),
            targetType: "questionnaire", targetId: id, targetLabel: label,
            detail: $"{await Mapper.ScopeLabelAsync(db, clientId, ct)} · fichier {filename} "
                  + $"({fileType}) · {parsed.Questions.Count} question(s) extraite(s)", ct: ct);

        var detail = await DetailAsync(id, ct) with { Warnings = parsed.Warnings };
        return StatusCode(StatusCodes.Status201Created, detail);
    }

    [HttpPost("manual")]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<ActionResult<QuestionnaireDetailResponse>> CreateManual(
        ManualQuestionnaireRequest payload, CancellationToken ct)
    {
        var parsed = QuestionnaireParser.ParseTextBlock(payload.Text);
        if (parsed.Questions.Count == 0)
            throw ApiException.Unprocessable("Aucune question exploitable dans le texte fourni.");

        if (!await db.Clients.AnyAsync(c => c.Id == payload.ClientId, ct))
            throw ApiException.NotFound("Client introuvable.");

        var label = payload.Name.Trim();
        var id = await InsertAsync(payload.ClientId, label, null, null, parsed, ct);

        await audit.RecordAsync("questionnaire.imported", actor: HttpContext.CurrentUser(),
            targetType: "questionnaire", targetId: id, targetLabel: label,
            detail: $"{await Mapper.ScopeLabelAsync(db, payload.ClientId, ct)} · saisie manuelle · "
                  + $"{parsed.Questions.Count} question(s)", ct: ct);

        return StatusCode(StatusCodes.Status201Created, await DetailAsync(id, ct));
    }

    [HttpGet("{questionnaireId:int}")]
    public Task<QuestionnaireDetailResponse> Get(int questionnaireId, CancellationToken ct) =>
        DetailAsync(questionnaireId, ct);

    [HttpDelete("{questionnaireId:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Delete(int questionnaireId, CancellationToken ct)
    {
        var questionnaire = await db.Questionnaires
            .FirstOrDefaultAsync(q => q.Id == questionnaireId, ct)
            ?? throw ApiException.NotFound("Questionnaire introuvable.");

        var questionCount = await db.QuestionnaireQuestions
            .CountAsync(x => x.QuestionnaireId == questionnaireId, ct);
        var storedPath = questionnaire.StoredPath;
        var label = questionnaire.Name;

        db.Questionnaires.Remove(questionnaire);
        await db.SaveChangesAsync(ct);
        StoragePaths.TryDelete(storedPath);

        await audit.RecordAsync("questionnaire.deleted", actor: HttpContext.CurrentUser(),
            targetType: "questionnaire", targetId: questionnaireId, targetLabel: label,
            detail: $"{questionCount} question(s) et le fichier d'origine supprimés", ct: ct);

        return NoContent();
    }

    /// <summary>Passe le moteur sur les questions non encore validées.</summary>
    [HttpPost("{questionnaireId:int}/autoanswer")]
    public async Task<QuestionnaireDetailResponse> AutoAnswer(
        int questionnaireId, [FromQuery] bool force = false, CancellationToken ct = default)
    {
        var questionnaire = await db.Questionnaires
            .FirstOrDefaultAsync(q => q.Id == questionnaireId, ct)
            ?? throw ApiException.NotFound("Questionnaire introuvable.");

        var clientId = questionnaire.ClientId;
        var index = await engine.GetIndexAsync(clientId, ct);

        // Sans `force`, les propositions déjà calculées sont conservées : relancer
        // ne doit pas écraser un travail de revue en cours.
        string[] statuses = force ? ["pending", "auto"] : ["pending"];
        var targets = await db.QuestionnaireQuestions
            .Where(x => x.QuestionnaireId == questionnaireId && statuses.Contains(x.Status))
            .OrderBy(x => x.Idx)
            .ToListAsync(ct);

        var counts = new Dictionary<string, int>
        {
            ["haute"] = 0, ["moyenne"] = 0, ["faible"] = 0, ["aucune"] = 0,
        };

        foreach (var question in targets)
        {
            var matches = index.Search(question.Text, clientId, topK: 5);
            var composed = SearchEngine.Compose(matches);
            var hasText = !string.IsNullOrEmpty(composed.Text);

            var band = hasText ? SearchIndex.Band(composed.Confidence) : "aucune";
            counts[band] = counts.GetValueOrDefault(band) + 1;

            question.SuggestedAnswer = hasText ? composed.Text : null;
            question.Confidence = composed.Confidence;
            question.MatchedKind = composed.Best?.Document.Kind;
            question.MatchedId = composed.Best?.Document.Id;
            question.CandidatesJson = JsonSerializer.Serialize(
                matches.Select(Mapper.ToCandidate).ToList(), Mapper.CandidateJson);
            question.Status = hasText ? "auto" : "pending";
        }

        questionnaire.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);

        var detail = await DetailAsync(questionnaireId, ct);
        return detail with { Run = new AutoAnswerRun(targets.Count, counts, index.Count) };
    }

    /// <summary>Valide en masse les propositions dont la confiance dépasse le seuil.</summary>
    [HttpPost("{questionnaireId:int}/validate-high")]
    public async Task<QuestionnaireDetailResponse> ValidateHighConfidence(
        int questionnaireId,
        [FromQuery] double threshold = SearchIndex.High,
        CancellationToken ct = default)
    {
        if (threshold is < 0 or > 1)
            throw ApiException.Unprocessable("Le seuil doit être compris entre 0 et 1.");

        var targets = await db.QuestionnaireQuestions
            .Where(x => x.QuestionnaireId == questionnaireId
                     && x.Status == "auto"
                     && x.Confidence >= threshold
                     && (x.SuggestedAnswer ?? "").Trim() != "")
            .ToListAsync(ct);

        foreach (var question in targets)
        {
            question.FinalAnswer ??= question.SuggestedAnswer;
            question.Status = "validated";

            if (question.MatchedKind == "kb" && question.MatchedId is { } entryId)
                await db.KbEntries.Where(e => e.Id == entryId)
                    .ExecuteUpdateAsync(set => set.SetProperty(e => e.UsageCount, e => e.UsageCount + 1), ct);
        }

        await db.Questionnaires.Where(q => q.Id == questionnaireId)
            .ExecuteUpdateAsync(set => set.SetProperty(q => q.UpdatedAt, DateTime.UtcNow), ct);
        await db.SaveChangesAsync(ct);

        var detail = await DetailAsync(questionnaireId, ct);
        return detail with { Validated = targets.Count };
    }

    [HttpGet("{questionnaireId:int}/export")]
    public async Task<IActionResult> Export(
        int questionnaireId, [FromQuery] string mode = "report", CancellationToken ct = default)
    {
        if (mode is not ("original" or "report"))
            throw ApiException.Unprocessable("Mode d'export inconnu : attendu « original » ou « report ».");

        var questionnaire = await db.Questionnaires
            .Include(q => q.Client)
            .FirstOrDefaultAsync(q => q.Id == questionnaireId, ct)
            ?? throw ApiException.NotFound("Questionnaire introuvable.");

        var questions = await db.QuestionnaireQuestions
            .Where(x => x.QuestionnaireId == questionnaireId)
            .OrderBy(x => x.Idx)
            .ToListAsync(ct);

        string target;
        try
        {
            if (mode == "original")
            {
                if (questionnaire.FileType != "xlsx" || string.IsNullOrWhiteSpace(questionnaire.StoredPath))
                    throw ApiException.BadRequest(
                        "La réinjection dans le fichier d'origine n'est possible que pour les "
                        + "questionnaires Excel. Utilisez l'export rapport.");
                target = exporter.ExportOriginal(questionnaire, questions);
            }
            else
            {
                target = exporter.ExportReport(questionnaire, questions, questionnaire.Client.Name);
            }
        }
        catch (FileNotFoundException exception)
        {
            throw ApiException.BadRequest(exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            throw ApiException.BadRequest(exception.Message);
        }

        // Un export fait sortir des réponses de conformité de l'outil : c'est
        // l'événement le plus important à tracer, avec qui l'a demandé et quand.
        var answered = questions.Count(q =>
            !string.IsNullOrWhiteSpace(q.FinalAnswer ?? q.SuggestedAnswer));

        await audit.RecordAsync("export.generated", actor: HttpContext.CurrentUser(),
            targetType: "questionnaire", targetId: questionnaireId, targetLabel: questionnaire.Name,
            detail: $"{await Mapper.ScopeLabelAsync(db, questionnaire.ClientId, ct)} · "
                  + $"mode {(mode == "original" ? "fichier client complété" : "rapport")} · "
                  + $"{answered}/{questions.Count} réponse(s) · fichier {Path.GetFileName(target)}",
            ct: ct);

        var bytes = await System.IO.File.ReadAllBytesAsync(target, ct);
        return File(bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Path.GetFileName(target));
    }

    // ----------------------------------------------------------------------
    // Helpers
    // ----------------------------------------------------------------------

    private async Task<int> InsertAsync(int clientId, string name, string? filename,
                                        string? storedPath, ParseResult parsed, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var questionnaire = new Questionnaire
        {
            ClientId = clientId,
            Name = name,
            OriginalFilename = filename,
            StoredPath = storedPath,
            FileType = parsed.FileType,
            Status = "en cours",
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Questionnaires.Add(questionnaire);
        await db.SaveChangesAsync(ct);

        foreach (var question in parsed.Questions)
        {
            db.QuestionnaireQuestions.Add(new QuestionnaireQuestion
            {
                QuestionnaireId = questionnaire.Id,
                Idx = question.Idx,
                Ref = question.Ref,
                Section = question.Section,
                Text = question.Text,
                LocatorJson = question.Locator is null
                    ? null : JsonSerializer.Serialize(question.Locator),
            });
        }
        await db.SaveChangesAsync(ct);
        return questionnaire.Id;
    }

    private async Task<QuestionnaireDetailResponse> DetailAsync(
        int questionnaireId, CancellationToken ct)
    {
        var questionnaire = await db.Questionnaires.AsNoTracking()
            .Include(q => q.Client)
            .FirstOrDefaultAsync(q => q.Id == questionnaireId, ct)
            ?? throw ApiException.NotFound("Questionnaire introuvable.");

        // La jointure sur KbEntries filtre les liaisons orphelines : une réponse
        // versée puis supprimée depuis la base de connaissance ne doit pas laisser
        // la question afficher « versée ».
        var rows = await db.QuestionnaireQuestions.AsNoTracking()
            .Where(x => x.QuestionnaireId == questionnaireId)
            .OrderBy(x => x.Idx)
            .Select(x => new
            {
                Question = x,
                PromotedAlive = x.PromotedKbEntry != null ? (int?)x.PromotedKbEntry.Id : null,
            })
            .ToListAsync(ct);

        var questions = rows
            .Select(row => Mapper.ToQuestion(row.Question, row.PromotedAlive))
            .ToList();

        var summary = new QuestionnaireSummary(
            Total: questions.Count,
            Answered: questions.Count(q =>
                !string.IsNullOrWhiteSpace(q.FinalAnswer ?? q.SuggestedAnswer)),
            Validated: questions.Count(q => q.Status == "validated"),
            Na: questions.Count(q => q.Status == "na"),
            Pending: questions.Count(q => q.Status == "pending"),
            High: questions.Count(q => q.Confidence >= SearchIndex.High),
            Medium: questions.Count(q =>
                q.Confidence >= SearchIndex.Medium && q.Confidence < SearchIndex.High),
            CanExportOriginal: questionnaire.FileType == "xlsx"
                            && !string.IsNullOrWhiteSpace(questionnaire.StoredPath));

        return new QuestionnaireDetailResponse(
            questionnaire.Id, questionnaire.ClientId, questionnaire.Client.Name, questionnaire.Name,
            questionnaire.OriginalFilename, questionnaire.FileType, questionnaire.Status,
            questionnaire.Notes, questionnaire.CreatedAt, questionnaire.UpdatedAt,
            questions, summary, [], null, null);
    }
}

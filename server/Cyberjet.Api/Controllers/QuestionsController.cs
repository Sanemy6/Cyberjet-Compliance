using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Controllers;

/// <summary>Revue question par question : ajustement, validation, versement dans
/// la base, recherche d'autres propositions.</summary>
[ApiController]
[Route("api/questions")]
public sealed class QuestionsController(
    AppDbContext db, AuditService audit, SearchEngine engine) : ControllerBase
{
    private static readonly string[] AllowedStatuses = ["pending", "auto", "validated", "na"];

    [HttpPatch("{questionId:int}")]
    public async Task<QuestionResponse> Patch(
        int questionId, QuestionPatchRequest payload, CancellationToken ct)
    {
        var question = await db.QuestionnaireQuestions
            .FirstOrDefaultAsync(x => x.Id == questionId, ct)
            ?? throw ApiException.NotFound("Question introuvable.");

        if (payload.Status is not null && !AllowedStatuses.Contains(payload.Status))
            throw ApiException.Unprocessable($"Statut « {payload.Status} » inconnu.");

        var previousStatus = question.Status;
        var finalAnswer = question.FinalAnswer;

        if (payload.FinalAnswer is not null)
        {
            var trimmed = payload.FinalAnswer.Trim();
            finalAnswer = trimmed.Length == 0 ? null : trimmed;
        }

        var status = payload.Status ?? question.Status;

        // Valider sans réponse explicite revient à entériner la proposition.
        if (status == "validated" && string.IsNullOrWhiteSpace(finalAnswer))
        {
            finalAnswer = question.SuggestedAnswer;
            if (string.IsNullOrWhiteSpace(finalAnswer))
                throw ApiException.BadRequest("Impossible de valider une question sans réponse.");
        }

        question.FinalAnswer = finalAnswer;
        question.Status = status;

        // Compteur de réutilisation : il mesure la valeur réelle de la base. Il
        // suit les deux sens de la bascule, sinon un aller-retour valider /
        // dévalider le gonflerait à chaque passage.
        if (question.MatchedKind == "kb" && question.MatchedId is { } entryId)
        {
            var was = previousStatus == "validated";
            var now = status == "validated";
            if (now && !was)
            {
                await db.KbEntries.Where(e => e.Id == entryId).ExecuteUpdateAsync(
                    set => set.SetProperty(e => e.UsageCount, e => e.UsageCount + 1), ct);
            }
            else if (was && !now)
            {
                // MAX(…, 0) par prudence : une base antérieure à ce décompte
                // symétrique pourrait déjà être désalignée.
                await db.KbEntries.Where(e => e.Id == entryId && e.UsageCount > 0).ExecuteUpdateAsync(
                    set => set.SetProperty(e => e.UsageCount, e => e.UsageCount - 1), ct);
            }
        }

        await db.Questionnaires.Where(q => q.Id == question.QuestionnaireId)
            .ExecuteUpdateAsync(set => set.SetProperty(q => q.UpdatedAt, DateTime.UtcNow), ct);
        await db.SaveChangesAsync(ct);

        return await ReadAsync(questionId, ct);
    }

    /// <summary>
    /// Retient l'entrée de base créée depuis cette question.
    ///
    /// Sans cette liaison, rien ne distingue une réponse déjà versée d'une réponse
    /// qui ne l'a jamais été : <c>MatchedId</c> désigne l'entrée d'où vient la
    /// proposition, pas celle que la question a produite.
    /// </summary>
    [HttpPost("{questionId:int}/promotion")]
    public async Task<QuestionResponse> LinkPromotion(
        int questionId, PromotionRequest payload, CancellationToken ct)
    {
        var question = await db.QuestionnaireQuestions
            .FirstOrDefaultAsync(x => x.Id == questionId, ct)
            ?? throw ApiException.NotFound("Question introuvable.");

        if (!await db.KbEntries.AnyAsync(e => e.Id == payload.KbEntryId, ct))
            throw ApiException.NotFound("Réponse introuvable dans la base.");

        question.PromotedKbEntryId = payload.KbEntryId;
        await db.SaveChangesAsync(ct);

        return await ReadAsync(questionId, ct);
    }

    /// <summary>Retire de la base la réponse versée depuis cette question.</summary>
    [HttpDelete("{questionId:int}/promotion")]
    public async Task<QuestionResponse> UnlinkPromotion(int questionId, CancellationToken ct)
    {
        var question = await db.QuestionnaireQuestions
            .FirstOrDefaultAsync(x => x.Id == questionId, ct)
            ?? throw ApiException.NotFound("Question introuvable.");

        var entryId = question.PromotedKbEntryId;
        var entry = entryId is null
            ? null
            : await db.KbEntries.FirstOrDefaultAsync(e => e.Id == entryId, ct);

        // La liaison est levée dans tous les cas : si l'entrée a déjà disparu de
        // la base, il n'y a rien à supprimer mais tout à délier.
        question.PromotedKbEntryId = null;
        await db.SaveChangesAsync(ct);

        if (entry is not null)
        {
            var scope = await Mapper.ScopeLabelAsync(db, entry.ClientId, ct);
            var label = entry.Question;

            db.KbEntries.Remove(entry);
            await db.SaveChangesAsync(ct);
            engine.Invalidate();

            await audit.RecordAsync("kb.deleted", actor: HttpContext.CurrentUser(),
                targetType: "kb_entry", targetId: entry.Id, targetLabel: label,
                detail: $"{scope} · retirée depuis la revue d'un questionnaire", ct: ct);
        }

        return await ReadAsync(questionId, ct);
    }

    /// <summary>Relance une recherche, éventuellement avec une reformulation manuelle.</summary>
    [HttpPost("{questionId:int}/rematch")]
    public async Task<object> Rematch(
        int questionId, RematchRequest payload, CancellationToken ct)
    {
        var row = await db.QuestionnaireQuestions.AsNoTracking()
            .Where(x => x.Id == questionId)
            .Select(x => new { x.Text, x.Questionnaire.ClientId })
            .FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Question introuvable.");

        var index = await engine.GetIndexAsync(row.ClientId, ct);
        var query = string.IsNullOrWhiteSpace(payload.Q) ? row.Text : payload.Q.Trim();
        var matches = index.Search(query, row.ClientId, topK: 8);

        return new { candidates = matches.Select(Mapper.ToCandidate).ToList() };
    }

    /// <summary>Applique manuellement un candidat proposé par le moteur.</summary>
    [HttpPost("{questionId:int}/apply")]
    public async Task<QuestionResponse> ApplyCandidate(
        int questionId, ApplyCandidateRequest payload, CancellationToken ct)
    {
        var question = await db.QuestionnaireQuestions
            .Include(x => x.Questionnaire)
            .FirstOrDefaultAsync(x => x.Id == questionId, ct)
            ?? throw ApiException.NotFound("Question introuvable.");

        var clientId = question.Questionnaire.ClientId;
        string? text = null;

        if (payload.Kind == "kb")
        {
            // Cloisonnement client : on ne recopie que ce que ce dossier a le
            // droit de voir — générique, ou rattaché à lui.
            text = await db.KbEntries
                .Where(e => e.Id == payload.SourceId
                         && (e.ClientId == null || e.ClientId == clientId))
                .Select(e => e.Answer)
                .FirstOrDefaultAsync(ct);
        }
        else if (payload.Kind == "config")
        {
            var config = await db.ConfigItems
                .Where(c => c.Id == payload.SourceId && c.ClientId == clientId)
                .Select(c => new { c.Label, c.Value, c.Details })
                .FirstOrDefaultAsync(ct);
            if (config is not null)
            {
                text = $"{config.Label} : {config.Value}";
                if (!string.IsNullOrWhiteSpace(config.Details)) text += $"\n{config.Details}";
            }
        }
        else
        {
            throw ApiException.Unprocessable($"Type de source « {payload.Kind} » inconnu.");
        }

        if (string.IsNullOrEmpty(text)) throw ApiException.NotFound("Source introuvable.");

        question.FinalAnswer = text;
        question.MatchedKind = payload.Kind;
        question.MatchedId = payload.SourceId;
        if (question.Status == "pending") question.Status = "auto";
        await db.SaveChangesAsync(ct);

        return await ReadAsync(questionId, ct);
    }

    private async Task<QuestionResponse> ReadAsync(int questionId, CancellationToken ct)
    {
        var row = await db.QuestionnaireQuestions.AsNoTracking()
            .Where(x => x.Id == questionId)
            .Select(x => new
            {
                Question = x,
                PromotedAlive = x.PromotedKbEntry != null ? (int?)x.PromotedKbEntry.Id : null,
            })
            .FirstOrDefaultAsync(ct)
            ?? throw ApiException.NotFound("Question introuvable.");

        return Mapper.ToQuestion(row.Question, row.PromotedAlive);
    }
}

using System.Globalization;
using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Search;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

using Microsoft.AspNetCore.Mvc;

namespace Cyberjet.Api.Controllers;

/// <summary>Tableau de bord, volumétrie, et vocabulaire de référence exposé au front.</summary>
[ApiController]
[Route("api")]
public sealed class StatsController(AppDbContext db, StoragePaths paths) : ControllerBase
{
    [HttpGet("stats")]
    public async Task<StatsResponse> Stats(CancellationToken ct)
    {
        var totalQuestions = await db.QuestionnaireQuestions.CountAsync(ct);
        var answered = await db.QuestionnaireQuestions
            .CountAsync(x => (x.FinalAnswer ?? x.SuggestedAnswer ?? "").Trim() != "", ct);

        var recent = await db.Questionnaires.AsNoTracking()
            .OrderByDescending(q => q.UpdatedAt)
            .Take(6)
            .Select(q => new RecentQuestionnaire(
                q.Id, q.Name, q.Status, q.FileType, q.UpdatedAt, q.Client.Name, q.ClientId,
                q.Questions.Count,
                q.Questions.Count(x => x.Status == "validated" || x.Status == "na")))
            .ToListAsync(ct);

        var topKb = await db.KbEntries.AsNoTracking()
            .Where(e => e.UsageCount > 0)
            .OrderByDescending(e => e.UsageCount)
            .Take(5)
            .Select(e => new TopKbEntry(e.Id, e.Question, e.Category, e.UsageCount))
            .ToListAsync(ct);

        // Type anonyme puis construction en mémoire : EF Core ne sait pas
        // traduire un GroupBy qui projette directement dans le constructeur d'un
        // record. Le regroupement et le tri restent bien exécutés par SQL Server.
        var byCategoryRows = await db.KbEntries.AsNoTracking()
            .GroupBy(e => e.Category)
            .Select(g => new { Category = g.Key, N = g.Count() })
            .OrderByDescending(row => row.N)
            .ToListAsync(ct);
        var byCategory = byCategoryRows
            .Select(row => new KbCategoryCount(row.Category, row.N))
            .ToList();

        return new StatsResponse(
            Clients: await db.Clients.CountAsync(c => c.Status == "actif", ct),
            KbTotal: await db.KbEntries.CountAsync(ct),
            KbGeneric: await db.KbEntries.CountAsync(e => e.ClientId == null, ct),
            KbValidated: await db.KbEntries.CountAsync(e => e.Status == "validated", ct),
            Configs: await db.ConfigItems.CountAsync(ct),
            QuestionnairesOpen: await db.Questionnaires.CountAsync(q => q.Status == "en cours", ct),
            QuestionnairesTotal: await db.Questionnaires.CountAsync(ct),
            QuestionsTotal: totalQuestions,
            QuestionsAnswered: answered,
            QuestionsValidated: await db.QuestionnaireQuestions
                .CountAsync(x => x.Status == "validated", ct),
            Coverage: totalQuestions > 0 ? Math.Round((double)answered / totalQuestions, 4) : 0.0,
            Frameworks: await db.Frameworks.CountAsync(ct),
            Controls: await db.Controls.CountAsync(ct),
            RecentQuestionnaires: recent,
            TopKb: topKb,
            ByCategory: byCategory);
    }

    /// <summary>Volumétrie : ce qui est stocké, comment ça grossit, ce qu'il reste à saisir.</summary>
    [HttpGet("storage")]
    public async Task<StorageResponse> Storage(CancellationToken ct)
    {
        var databaseBytes = await DatabaseSizeBytesAsync(ct);
        var uploads = StoragePaths.Measure(paths.UploadDirectory);
        var exports = StoragePaths.Measure(paths.ExportDirectory);

        // Douze derniers mois, trous compris : une série à trous se lit mal.
        var firstOfMonth = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
        var months = Enumerable.Range(0, 12)
            .Select(offset => firstOfMonth.AddMonths(-offset).ToString("yyyy-MM", CultureInfo.InvariantCulture))
            .Reverse()
            .ToList();

        var kbByMonth = (await db.KbEntries
                .GroupBy(e => new { e.CreatedAt.Year, e.CreatedAt.Month })
                .Select(g => new { g.Key.Year, g.Key.Month, N = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(row => $"{row.Year:D4}-{row.Month:D2}", row => row.N);

        var questionnairesByMonth = (await db.Questionnaires
                .GroupBy(q => new { q.CreatedAt.Year, q.CreatedAt.Month })
                .Select(g => new { g.Key.Year, g.Key.Month, N = g.Count() })
                .ToListAsync(ct))
            .ToDictionary(row => $"{row.Year:D4}-{row.Month:D2}", row => row.N);

        var kbCount = await db.KbEntries.CountAsync(ct);
        var configCount = await db.ConfigItems.CountAsync(ct);

        var counts = new StorageCounts(
            Clients: await db.Clients.CountAsync(ct),
            Kb: kbCount,
            KbGeneric: await db.KbEntries.CountAsync(e => e.ClientId == null, ct),
            Configs: configCount,
            Questionnaires: await db.Questionnaires.CountAsync(ct),
            Questions: await db.QuestionnaireQuestions.CountAsync(ct),
            ControlLinks: await db.KbEntryControls.CountAsync(ct),
            Indexed: kbCount + configCount);

        var averageChars = kbCount == 0
            ? 0
            : (int)Math.Round(await db.KbEntries
                .AverageAsync(e => (double)(e.Question.Length + e.Answer.Length), ct));

        var staleBefore = DateTime.UtcNow.Date.AddDays(-365);
        var backlog = new BacklogCounts(
            // Réponses écrites à la main pendant une revue : elles ne sont pas
            // encore dans la base et seront donc réécrites au prochain client.
            Uncapitalised: await db.QuestionnaireQuestions.CountAsync(
                x => x.Status == "validated" && x.MatchedKind == null
                  && (x.FinalAnswer ?? "").Trim() != "", ct),
            // Propositions corrigées à la main : l'entrée d'origine a vieilli.
            Corrected: await db.QuestionnaireQuestions.CountAsync(
                x => x.Status == "validated" && x.MatchedKind == "kb"
                  && (x.FinalAnswer ?? "").Trim() != ""
                  && x.FinalAnswer != (x.SuggestedAnswer ?? ""), ct),
            Drafts: await db.KbEntries.CountAsync(e => e.Status == "draft", ct),
            Stale: await db.KbEntries.CountAsync(
                e => e.Status == "validated" && (e.ReviewedAt ?? e.CreatedAt) < staleBefore, ct),
            ClientsWithoutConfig: await db.Clients.CountAsync(c => !c.ConfigItems.Any(), ct));

        var perClient = await db.Clients.AsNoTracking()
            .OrderBy(c => c.Name)
            .Select(c => new PerClientRow(
                c.Id, c.Name, c.KbEntries.Count, c.ConfigItems.Count,
                c.Questionnaires.Sum(q => q.Questions.Count)))
            .ToListAsync(ct);

        return new StorageResponse(
            Disk: new DiskUsage(
                Database: new DirectoryUsage(1, databaseBytes),
                Uploads: new DirectoryUsage(uploads.Count, uploads.Bytes),
                Exports: new DirectoryUsage(exports.Count, exports.Bytes),
                Total: databaseBytes + uploads.Bytes + exports.Bytes,
                Path: paths.DataDirectory),
            Counts: counts,
            AvgEntryChars: averageChars,
            Growth: [.. months.Select(month => new GrowthPoint(
                month, kbByMonth.GetValueOrDefault(month), questionnairesByMonth.GetValueOrDefault(month)))],
            Backlog: backlog,
            Coverage: await ClientsController.CoverageAsync(db, null, ct),
            PerClient: perClient);
    }

    /// <summary>Vocabulaire de référence exposé au front : listes déroulantes et seuils.</summary>
    [HttpGet("meta")]
    public MetaResponse Meta() => new(
        Categories: ["Général", .. Thesaurus.Categories.Order(StringComparer.CurrentCulture)],
        ConfigCategories:
        [
            "Chiffrement", "Identité & accès", "Réseau & infrastructure",
            "Sauvegarde & continuité", "Journalisation & supervision",
            "Poste de travail", "Cloud & hébergement", "Développement",
            "Sécurité physique", "Autre",
        ],
        ConfigStatuses: ["en place", "partiel", "planifié", "non applicable"],
        Thresholds: new ThresholdSet(SearchIndex.High, SearchIndex.Medium, SearchIndex.Low));

    /// <summary>
    /// Taille allouée à la base sur le serveur SQL, journal compris. C'est la
    /// mesure qui compte pour dimensionner un volume — pas la taille des données
    /// utiles, toujours plus faible.
    /// </summary>
    private async Task<long> DatabaseSizeBytesAsync(CancellationToken ct)
    {
        try
        {
            await using var connection = new SqlConnection(db.Database.GetConnectionString());
            await connection.OpenAsync(ct);
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT ISNULL(SUM(CAST(size AS BIGINT)), 0) * 8 * 1024 FROM sys.database_files";
            var result = await command.ExecuteScalarAsync(ct);
            return result is long bytes ? bytes : Convert.ToInt64(result, CultureInfo.InvariantCulture);
        }
        catch (SqlException)
        {
            // Droits insuffisants sur sys.database_files (compte applicatif
            // restreint) : l'écran reste utilisable, seule cette mesure manque.
            return 0;
        }
    }
}

using System.Text.Json;
using System.Text.RegularExpressions;
using Cyberjet.Api.Data;
using Cyberjet.Api.Services.Search;
using Microsoft.EntityFrameworkCore;

namespace Cyberjet.Api.Contracts;

/// <summary>
/// Erreur métier destinée au client : elle porte son propre code HTTP et un
/// message rédigé pour être affiché tel quel.
///
/// Le front n'a pas à traduire des codes techniques en phrases françaises — il
/// le ferait moins bien, et deux écrans finiraient par ne pas dire la même chose
/// de la même erreur.
/// </summary>
public sealed class ApiException(int statusCode, string detail) : Exception(detail)
{
    public int StatusCode { get; } = statusCode;

    public static ApiException NotFound(string detail) => new(404, detail);
    public static ApiException Conflict(string detail) => new(409, detail);
    public static ApiException BadRequest(string detail) => new(400, detail);
    public static ApiException Forbidden(string detail) => new(403, detail);
    public static ApiException Unauthorized(string detail) => new(401, detail);
    public static ApiException Unprocessable(string detail) => new(422, detail);
    public static ApiException TooManyRequests(string detail) => new(429, detail);
}

public static partial class Mapper
{
    /// <summary>
    /// Sérialisation des candidats mis en cache dans <c>CandidatesJson</c>.
    ///
    /// Même casse que celle rendue par l'API : la colonne contient exactement ce
    /// que le front recevrait d'un rapprochement en direct, et un contrôle à
    /// l'œil sur la base se lit sans traduction mentale.
    /// </summary>
    public static readonly JsonSerializerOptions CandidateJson = new(JsonSerializerDefaults.Web);

    // ----------------------------------------------------------------------
    // Préférences d'interface
    //
    // Liste blanche stricte : ces valeurs sont réécrites telles quelles dans les
    // attributs du document, accepter des clés arbitraires reviendrait à laisser
    // un compte stocker n'importe quoi sous couvert de « réglage ».
    // ----------------------------------------------------------------------
    private static readonly Dictionary<string, string[]> PreferenceValues = new()
    {
        ["theme"] = ["auto", "light", "dark"],
        ["accent"] = ["azur", "indigo", "emeraude", "ardoise", "cuivre"],
        ["density"] = ["confort", "compact"],
        ["sidebar"] = ["expanded", "collapsed"],
        ["motion"] = ["full", "reduced"],
    };

    private static readonly Dictionary<string, string> PreferenceDefaults = new()
    {
        // « auto » reste une valeur acceptée (voir PreferenceValues) : un
        // compte peut toujours le choisir ensuite. Mais démarrer un compte
        // neuf sur le thème système du premier poste où il se connecte n'a
        // pas de sens — le clair est le point de départ prévisible.
        ["theme"] = "light",
        ["accent"] = "azur",
        ["density"] = "confort",
        ["sidebar"] = "expanded",
        ["motion"] = "full",
    };

    /// <summary>
    /// Toujours renvoyer un jeu complet : une préférence absente ou devenue
    /// invalide — valeur retirée du catalogue — retombe sur sa valeur par défaut
    /// plutôt que de remonter telle quelle jusqu'au CSS.
    /// </summary>
    public static Dictionary<string, string> ReadPreferences(string? raw)
    {
        Dictionary<string, string>? stored = null;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try { stored = JsonSerializer.Deserialize<Dictionary<string, string>>(raw); }
            catch (JsonException) { stored = null; }
        }

        var result = new Dictionary<string, string>();
        foreach (var (key, fallback) in PreferenceDefaults)
        {
            var candidate = stored is not null && stored.TryGetValue(key, out var value) ? value : null;
            result[key] = candidate is not null && PreferenceValues[key].Contains(candidate)
                ? candidate : fallback;
        }
        return result;
    }

    public static Dictionary<string, string> MergePreferences(string? raw, PreferencesRequest patch)
    {
        var merged = ReadPreferences(raw);
        void Apply(string key, string? value)
        {
            if (value is null) return;
            if (!PreferenceValues[key].Contains(value))
                throw ApiException.Unprocessable($"Valeur de préférence invalide pour « {key} ».");
            merged[key] = value;
        }

        Apply("theme", patch.Theme);
        Apply("accent", patch.Accent);
        Apply("density", patch.Density);
        Apply("sidebar", patch.Sidebar);
        Apply("motion", patch.Motion);
        return merged;
    }

    public static string SerializePreferences(Dictionary<string, string> preferences) =>
        JsonSerializer.Serialize(preferences);

    // ----------------------------------------------------------------------
    // Nettoyage des champs libres
    // ----------------------------------------------------------------------

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")]
    private static partial Regex EmailPattern();

    /// <summary>Volontairement permissif : indicatifs, espaces, points, tirets,
    /// parenthèses. Un contrôle strict des numéros internationaux refuserait des
    /// numéros parfaitement valides — pour un champ de contact, ce serait pénible
    /// sans rien protéger. On vérifie seulement qu'il y a des chiffres et pas de
    /// fantaisie.</summary>
    [GeneratedRegex(@"^\+?[\d\s().\-/]{6,40}$")]
    private static partial Regex PhonePattern();

    /// <summary>Chaîne vide traitée comme absence : effacer une adresse est une
    /// opération légitime.</summary>
    public static string? CleanEmail(string? value)
    {
        if (value is null) return null;
        var trimmed = value.Trim();
        if (trimmed.Length == 0) return null;
        if (!EmailPattern().IsMatch(trimmed))
            throw ApiException.Unprocessable("Adresse électronique invalide.");
        return trimmed;
    }

    public static string? CleanPhone(string? value)
    {
        if (value is null) return null;
        var trimmed = value.Trim();
        if (trimmed.Length == 0) return null;
        if (!PhonePattern().IsMatch(trimmed) || trimmed.Count(char.IsAsciiDigit) < 6)
            throw ApiException.Unprocessable("Numéro de téléphone invalide.");
        return trimmed;
    }

    public static string? CleanText(string? value)
    {
        if (value is null) return null;
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    // ----------------------------------------------------------------------
    // Portée d'une entrée, pour le journal d'audit
    // ----------------------------------------------------------------------

    /// <summary>« portée générique » ou « client Nordic Wings ». Le journal doit
    /// dire de quel dossier relève l'objet touché, sans qu'on ait à recouper avec
    /// la base — un client supprimé depuis rendrait la trace illisible.</summary>
    public static async Task<string> ScopeLabelAsync(
        AppDbContext db, int? clientId, CancellationToken ct)
    {
        if (clientId is null) return "portée générique";
        var name = await db.Clients.Where(c => c.Id == clientId)
                                   .Select(c => c.Name)
                                   .FirstOrDefaultAsync(ct);
        return name is null ? $"client #{clientId}" : $"client {name}";
    }

    // ----------------------------------------------------------------------
    // Comptes
    // ----------------------------------------------------------------------

    /// <param name="lockedFor">Verrouillage anti-bruteforce en cours, s'il y en
    /// a un. Passé par l'appelant plutôt que lu ici : ce convertisseur reste
    /// une projection d'entité, sans service à sa charge.</param>
    public static PublicUserResponse ToPublicUser(AppUser user, TimeSpan? lockedFor = null) => new(
        user.Id, user.Username, user.IsAdmin, user.Active, user.CreatedAt, user.LastLoginAt,
        user.TotpEnabled, user.MfaEnabledAt, user.Email, user.Phone, user.JobTitle,
        user.FirstName, user.LastName, user.DisplayName,
        lockedFor is { } wait ? Math.Max((int)Math.Ceiling(wait.TotalMinutes), 1) : null);

    // ----------------------------------------------------------------------
    // Moteur
    // ----------------------------------------------------------------------

    public static CandidateResponse ToCandidate(SearchMatch match)
    {
        var doc = match.Document;
        return new CandidateResponse(
            doc.Kind, doc.Id, doc.ClientId, doc.Title, doc.Body, doc.Category, doc.Status,
            [.. doc.Refs],
            Math.Round(match.Confidence, 4),
            SearchIndex.Band(match.Confidence),
            match.RefHit,
            [.. match.MatchedTerms.Take(12)],
            new Dictionary<string, string?>(doc.Extra));
    }

    public static List<CandidateResponse> ReadCandidates(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<CandidateResponse>>(json, CandidateJson) ?? [];
        }
        catch (JsonException)
        {
            // Cache de candidats illisible (format changé entre deux versions) :
            // la question reste utilisable, seule la liste « autres propositions »
            // repart vide jusqu'au prochain rapprochement.
            return [];
        }
    }

    // ----------------------------------------------------------------------
    // Base de connaissance
    // ----------------------------------------------------------------------

    public static KbEntryResponse ToKbEntry(KbEntry entry, string? clientName,
                                            List<ControlChipResponse> controls) => new(
        entry.Id, entry.ClientId, clientName, entry.Question, entry.Answer, entry.Category,
        entry.Tags, entry.Status, entry.Evidence, entry.Source, entry.UsageCount,
        entry.CreatedAt, entry.UpdatedAt, entry.ReviewedAt, controls);

    public static ConfigResponse ToConfig(ConfigItem item, string? clientName = null) => new(
        item.Id, item.ClientId, clientName, item.Category, item.Label, item.Value,
        item.Details, item.Scope, item.Status, item.UpdatedAt);

    public static QuestionResponse ToQuestion(QuestionnaireQuestion question, int? promotedAlive) => new(
        question.Id, question.QuestionnaireId, question.Idx, question.Ref, question.Section,
        question.Text, question.SuggestedAnswer, question.FinalAnswer, question.Status,
        question.Confidence, SearchIndex.Band(question.Confidence), question.MatchedKind,
        question.MatchedId, promotedAlive, ReadCandidates(question.CandidatesJson));
}

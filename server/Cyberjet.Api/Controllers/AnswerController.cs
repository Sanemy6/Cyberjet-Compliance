using Cyberjet.Api.Contracts;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Mvc;

namespace Cyberjet.Api.Controllers;

/// <summary>
/// Interrogation directe du moteur — l'assistant réponse. Même chemin de code
/// que le traitement d'un questionnaire, ce qui garantit qu'un essai à l'écran
/// prédit exactement ce que produira l'import.
/// </summary>
[ApiController]
[Route("api/answer")]
public sealed class AnswerController(SearchEngine engine) : ControllerBase
{
    [HttpPost]
    public async Task<AnswerResponse> Ask(AnswerQueryRequest payload, CancellationToken ct)
    {
        var topK = Math.Clamp(payload.TopK ?? 5, 1, 20);

        var index = await engine.GetIndexAsync(payload.ClientId, ct);
        var matches = index.Search(payload.Question, payload.ClientId, topK);
        var composed = SearchEngine.Compose(matches);

        return new AnswerResponse(
            Answer: composed.Text,
            Confidence: Math.Round(composed.Confidence, 4),
            Band: SearchIndex.Band(composed.Confidence),
            Best: composed.Best is null ? null : Mapper.ToCandidate(composed.Best),
            Candidates: [.. matches.Select(Mapper.ToCandidate)],
            IndexedDocuments: index.Count);
    }
}

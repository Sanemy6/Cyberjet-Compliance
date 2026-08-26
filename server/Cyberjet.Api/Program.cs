using System.Text;
using System.Text.Json.Serialization;
using Cyberjet.Api.Contracts;
using Cyberjet.Api.Data;
using Cyberjet.Api.Middleware;
using Cyberjet.Api.Services;
using Cyberjet.Api.Services.Auth;
using Cyberjet.Api.Services.Export;
using Cyberjet.Api.Services.Search;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Windows-1252 : c'est l'encodage des CSV exportés depuis un Excel francophone.
// .NET ne le connaît pas sans ce fournisseur.
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

// --------------------------------------------------------------------------
// Services
// --------------------------------------------------------------------------
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException(
        "Chaîne de connexion « ConnectionStrings:Default » absente de la configuration.");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(connectionString, sql => sql.EnableRetryOnFailure()));

builder.Services.AddHttpContextAccessor();

builder.Services
    .AddOptions<SecurityOptions>()
    .Bind(builder.Configuration.GetSection(SecurityOptions.SectionName));

builder.Services.AddSingleton<AppSettingsService>();
builder.Services.AddSingleton<StoragePaths>();
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddSingleton<AuditService>();
builder.Services.AddSingleton<ExcelExporter>();
// L'index est immuable une fois construit : un singleton le partage entre
// requêtes concurrentes sans verrou.
builder.Services.AddSingleton<SearchEngine>();
builder.Services.AddScoped<SessionService>();

builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        // Les accents et apostrophes typographiques doivent sortir tels quels :
        // l'API sert une interface française, pas des échappements é.
        options.JsonSerializerOptions.Encoder =
            System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
    });

// Les erreurs de validation sortent au même format que les erreurs métier :
// le front n'a qu'un seul champ à lire, `detail`.
builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    options.InvalidModelStateResponseFactory = context =>
    {
        var message = context.ModelState
            .Where(entry => entry.Value?.Errors.Count > 0)
            .Select(entry =>
            {
                var field = entry.Key.Split('.').LastOrDefault() ?? entry.Key;
                var error = entry.Value!.Errors[0].ErrorMessage;
                return string.IsNullOrEmpty(field) ? error : $"{field} : {error}";
            })
            .FirstOrDefault() ?? "Requête invalide.";

        return new BadRequestObjectResult(new { detail = message });
    };
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
    options.SwaggerDoc("v1", new() { Title = "Cyberjet Compliance", Version = "v1" }));

var app = builder.Build();

// --------------------------------------------------------------------------
// Pipeline
// --------------------------------------------------------------------------

// Toute exception non gérée sort en JSON `{ detail }` : c'est ce que le client
// HTTP du front sait lire, et une page d'erreur HTML au milieu d'un fetch ne
// donne qu'un message illisible.
app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var feature = context.Features.Get<IExceptionHandlerFeature>();
    var exception = feature?.Error;

    var (status, detail) = exception switch
    {
        ApiException api => (api.StatusCode, api.Message),
        BadHttpRequestException bad => (bad.StatusCode, "Requête invalide."),
        _ => (StatusCodes.Status500InternalServerError,
              "Une erreur interne est survenue. Consultez les journaux du serveur."),
    };

    if (status >= 500)
    {
        context.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("Cyberjet.Api")
            .LogError(exception, "Erreur non gérée sur {Path}", context.Request.Path);
    }

    context.Response.StatusCode = status;
    context.Response.ContentType = "application/json; charset=utf-8";
    await context.Response.WriteAsJsonAsync(new { detail });
}));

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// L'application React compilée est servie depuis wwwroot en production. En
// développement, c'est Vite qui sert le front et relaie /api vers ici.
//
// Deux régimes de cache, et c'est important : les fichiers d'`assets/` portent
// une empreinte dans leur nom (index-CjWVxkOh.js), ils sont donc immuables et
// peuvent être gardés un an. `index.html`, lui, ne change jamais de nom mais
// change de contenu à chaque déploiement — un navigateur qui le garde continue
// de réclamer l'ancien bundle et l'utilisateur reste sur une version périmée,
// bug compris.
app.UseMiddleware<SecurityHeadersMiddleware>();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var path = context.File.Name;
        var headers = context.Context.Response.Headers;

        if (path.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            headers.CacheControl = "no-cache, must-revalidate";
        else if (context.Context.Request.Path.StartsWithSegments("/assets"))
            headers.CacheControl = "public, max-age=31536000, immutable";
    },
});

app.UseMiddleware<AuthGateMiddleware>();

app.MapControllers();

// Routage côté client : toute URL inconnue rend le shell, qui décide de la vue.
// Les chemins /api restent hors de cette reprise, sinon une faute de frappe
// d'endpoint renverrait du HTML avec un code 200.
app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsJsonAsync(new { detail = "Endpoint inconnu." });
        return;
    }

    var webRoot = string.IsNullOrEmpty(app.Environment.WebRootPath)
        ? Path.Combine(app.Environment.ContentRootPath, "wwwroot")
        : app.Environment.WebRootPath;
    var index = Path.Combine(webRoot, "index.html");

    if (!File.Exists(index))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        await context.Response.WriteAsync(
            "Interface non déployée. En développement, lancez le serveur Vite "
            + "(npm run dev dans client/).");
        return;
    }

    // Même règle que ci-dessus : le shell rendu en repli de route ne doit pas
    // être mis en cache, sinon un déploiement passe inaperçu.
    context.Response.ContentType = "text/html; charset=utf-8";
    context.Response.Headers.CacheControl = "no-cache, must-revalidate";
    await context.Response.SendFileAsync(index);
});

// --------------------------------------------------------------------------
// Démarrage : schéma, référentiels, ménage
// --------------------------------------------------------------------------
try
{
    await DatabaseInitializer.InitializeAsync(app.Services);

    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var sessions = scope.ServiceProvider.GetRequiredService<SessionService>();

    await FrameworkSeeder.SeedAsync(db);
    await sessions.CleanupExpiredSessionsAsync();
    await AuditService.PurgeExpiredAsync(db);
}
catch (StartupException exception)
{
    // Message seul, sans pile : le problème est une configuration à corriger,
    // pas un défaut à déboguer. Code de sortie 1 pour que NSSM ou un
    // orchestrateur voie l'échec.
    Console.Error.WriteLine();
    Console.Error.WriteLine(exception.Message);
    Console.Error.WriteLine();
    return 1;
}

app.Run();
return 0;

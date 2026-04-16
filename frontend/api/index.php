<?php
declare(strict_types=1);

/**
 * Proxy público de API:
 *   /conteo/api/v1/... -> https://api-elecciones.perulainen.com/conteo/api/v1/... .json
 *
 * Objetivo: mantener un endpoint estable en perulainen.com para el frontend,
 * mientras el origen de artefactos vive en el subdominio API.
 */

function respondJson(int $status, array $payload): void {
    http_response_code($status);
    header("Content-Type: application/json; charset=utf-8");
    header("Cache-Control: no-store");
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function getRequestRelativePath(): string {
    $requestPath = (string) parse_url($_SERVER["REQUEST_URI"] ?? "/", PHP_URL_PATH);
    $scriptName = $_SERVER["SCRIPT_NAME"] ?? "/conteo/api/index.php";
    $prefix = preg_replace("~index\\.php$~", "", $scriptName);
    $prefix = rtrim((string) $prefix, "/");

    if ($prefix !== "" && str_starts_with($requestPath, $prefix . "/")) {
        return ltrim(substr($requestPath, strlen($prefix)), "/");
    }
    if (str_starts_with($requestPath, "/api/")) {
        return ltrim(substr($requestPath, 5), "/");
    }
    return ltrim($requestPath, "/");
}

function resolveDefaultOriginBase(): string {
    $host = strtolower((string) ($_SERVER["HTTP_HOST"] ?? ""));
    if (str_starts_with($host, "staging.perulainen.com")) {
        return "https://api-elecciones.perulainen.com/staging/conteo/api";
    }
    return "https://api-elecciones.perulainen.com/conteo/api";
}

function buildOriginUrl(string $relativePath): string {
    $originBase = getenv("CONTEO_API_ORIGIN_BASE");
    if (!$originBase) {
        $originBase = resolveDefaultOriginBase();
    }
    $originBase = rtrim($originBase, "/");
    return $originBase . "/" . $relativePath . ".json";
}

function fetchOrigin(string $url): array {
    $timeoutSeconds = (int) (getenv("CONTEO_API_TIMEOUT_SECONDS") ?: 6);
    $headers = [];
    if (!empty($_SERVER["HTTP_IF_NONE_MATCH"])) {
        $headers[] = "If-None-Match: " . $_SERVER["HTTP_IF_NONE_MATCH"];
    }
    if (!empty($_SERVER["HTTP_IF_MODIFIED_SINCE"])) {
        $headers[] = "If-Modified-Since: " . $_SERVER["HTTP_IF_MODIFIED_SINCE"];
    }

    if (function_exists("curl_init")) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeoutSeconds);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSeconds);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_HEADER, true);
        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException("curl_error: " . $err);
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $respHeaders = substr($raw, 0, $headerSize);
        $body = substr($raw, $headerSize);
        curl_close($ch);
        return ["status" => $status, "headers" => $respHeaders, "body" => $body];
    }

    $context = stream_context_create([
        "http" => [
            "method" => "GET",
            "timeout" => $timeoutSeconds,
            "ignore_errors" => true,
            "header" => implode("\r\n", $headers),
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    $meta = $http_response_header ?? [];
    $status = 502;
    if (!empty($meta[0]) && preg_match("/\\s(\\d{3})\\s/", $meta[0], $m)) {
        $status = (int) $m[1];
    }
    return ["status" => $status, "headers" => implode("\r\n", $meta), "body" => $body === false ? "" : $body];
}

$relativePath = getRequestRelativePath();
if (!preg_match("~^v1/[a-z0-9_-]+/[a-z0-9_-]+$~", $relativePath)) {
    respondJson(404, [
        "error" => "endpoint_not_found",
        "message" => "Ruta no válida. Usa /api/v1/{grupo}/{recurso}",
    ]);
}

$originUrl = buildOriginUrl($relativePath);

try {
    $origin = fetchOrigin($originUrl);
} catch (Throwable $e) {
    respondJson(502, [
        "error" => "origin_unreachable",
        "message" => "No se pudo alcanzar el origen API",
        "detail" => $e->getMessage(),
    ]);
}

$status = (int) ($origin["status"] ?? 502);
$rawHeaders = (string) ($origin["headers"] ?? "");
$body = (string) ($origin["body"] ?? "");

if ($status === 304) {
    http_response_code(304);
    exit;
}
if ($status < 200 || $status >= 300) {
    respondJson(502, [
        "error" => "origin_bad_status",
        "message" => "El origen devolvió estado inesperado",
        "origin_status" => $status,
    ]);
}

header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
header("X-Content-Type-Options: nosniff");
if (preg_match("/^ETag:\\s*(.+)$/mi", $rawHeaders, $m)) {
    header("ETag: " . trim($m[1]));
}
if (preg_match("/^Last-Modified:\\s*(.+)$/mi", $rawHeaders, $m)) {
    header("Last-Modified: " . trim($m[1]));
}

echo $body;

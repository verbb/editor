<?php

declare(strict_types=1);

namespace Tests\Support;

use RuntimeException;

final class HttpSession
{
    private string $cookieFile;
    private array $lastHeaders = [];
    public ?string $csrfToken = null;

    public function __construct()
    {
        $this->cookieFile = tempnam(sys_get_temp_dir(), 'editor-cookies-');
    }

    public function __destruct()
    {
        @unlink($this->cookieFile);
    }

    public function header(string $name): ?string
    {
        return $this->lastHeaders[strtolower($name)] ?? null;
    }

    public function refreshCsrf(): void
    {
        $this->csrfToken = $this->request('GET', '/actions/users/session-info')['json']['csrfTokenValue'] ?? null;

        if ($this->csrfToken === null) {
            throw new RuntimeException('The test session has no CSRF token.');
        }
    }

    public function login(string $loginName, string $password = Factory::PASSWORD): void
    {
        $this->refreshCsrf();
        $response = $this->post('/actions/users/login', ['loginName' => $loginName, 'password' => $password]);

        if ($response['status'] !== 200) {
            throw new RuntimeException('Test login failed: ' . $response['body']);
        }

        $this->refreshCsrf();
    }

    public function post(string $path, array $body = [], bool $withCsrf = true, array $headers = []): array
    {
        if ($withCsrf && $this->csrfToken !== null) {
            $headers[] = 'X-CSRF-Token: ' . $this->csrfToken;
        }

        return $this->request('POST', $path, json_encode($body), array_merge(['Content-Type: application/json'], $headers));
    }

    public function upload(string $path, array $fields, string $fileField, string $fileName, string $contents, bool $withCsrf = true): array
    {
        $file = tempnam(sys_get_temp_dir(), 'editor-http-upload-');
        file_put_contents($file, $contents);
        $body = $fields + [$fileField => new \CURLFile($file, 'application/octet-stream', $fileName)];
        $headers = $withCsrf && $this->csrfToken !== null ? ['X-CSRF-Token: ' . $this->csrfToken] : [];

        try {
            return $this->request('POST', $path, $body, $headers);
        } finally {
            unlink($file);
        }
    }

    public function request(string $method, string $path, string|array|null $body = null, array $headers = []): array
    {
        $this->lastHeaders = [];
        $curl = curl_init(HttpServer::url($path));
        curl_setopt_array($curl, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_COOKIEJAR => $this->cookieFile,
            CURLOPT_COOKIEFILE => $this->cookieFile,
            CURLOPT_HTTPHEADER => preg_grep('/^Accept:/i', $headers) ? $headers : array_merge(['Accept: application/json'], $headers),
            CURLOPT_TIMEOUT => 60,
            // Craft refuses to create a session for a request with no user agent.
            CURLOPT_USERAGENT => 'Editor test suite',
            CURLOPT_HEADERFUNCTION => function($curl, string $line): int {
                $parts = explode(':', $line, 2);

                if (count($parts) === 2) {
                    $this->lastHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }

                return strlen($line);
            },
        ]);

        if ($body !== null) {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }

        $responseBody = curl_exec($curl);

        if ($responseBody === false) {
            throw new RuntimeException('Test request failed: ' . curl_error($curl));
        }

        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);

        return ['status' => $status, 'body' => $responseBody, 'json' => json_decode($responseBody, true)];
    }
}

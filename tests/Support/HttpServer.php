<?php

declare(strict_types=1);

namespace Tests\Support;

use RuntimeException;

/**
 * One `php -S` process for the test run, and a small session-aware client for it.
 */
final class HttpServer
{
    private static mixed $process = null;
    private static int $port = 0;

    public static function url(string $path = ''): string
    {
        self::start();

        return 'http://127.0.0.1:' . self::$port . $path;
    }

    private static function start(): void
    {
        if (self::$process !== null) {
            return;
        }

        $socket = stream_socket_server('tcp://127.0.0.1:0');
        self::$port = (int)substr(strrchr(stream_socket_get_name($socket, false), ':'), 1);
        fclose($socket);

        $root = dirname(__DIR__, 2);
        $command = [PHP_BINARY, '-d', 'upload_max_filesize=8M', '-S', '127.0.0.1:' . self::$port, '-t', $root . '/tests/_craft/web', $root . '/tests/bin/http-router.php'];
        self::$process = proc_open($command, [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $root);

        register_shutdown_function(static function(): void {
            if (is_resource(self::$process)) {
                proc_terminate(self::$process);
            }
        });

        for ($i = 0; $i < 100; $i++) {
            $connection = @fsockopen('127.0.0.1', self::$port);

            if ($connection) {
                fclose($connection);

                return;
            }

            usleep(100000);
        }

        throw new RuntimeException('The test HTTP server did not start.');
    }
}

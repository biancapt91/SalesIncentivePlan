<?php

function env(string $key, $default = null)
{
    static $env = null;

    if ($env === null) {

        $env = [];

        $path = dirname(__DIR__) . '/.env';

        if (file_exists($path)) {

            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {

                $line = trim($line);

                if ($line === '' || str_starts_with($line, '#')) {
                    continue;
                }

                if (!str_contains($line, '=')) {
                    continue;
                }

                [$k, $v] = explode('=', $line, 2);

                $env[trim($k)] = trim($v);
            }
        }
    }

    return $env[$key] ?? $default;
}
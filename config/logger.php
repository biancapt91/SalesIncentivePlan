<?php

function logError(Throwable $e): void
{
    $logDir = dirname(__DIR__) . '/logs';

    if (!is_dir($logDir)) {
        mkdir($logDir, 0755, true);
    }

    $logFile = $logDir . '/error.log';

    $message = sprintf(
        "[%s]\n%s\nFile : %s\nLine : %d\n\n",
        date('Y-m-d H:i:s'),
        $e->getMessage(),
        $e->getFile(),
        $e->getLine()
    );

    error_log($message, 3, $logFile);
}
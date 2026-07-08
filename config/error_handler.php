<?php

require_once __DIR__ . '/logger.php';

set_exception_handler(function (Throwable $e) {

    logError($e);

    if (APP_DEBUG) {

    header('Content-Type: application/json');    
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage(),
        'file'    => basename($e->getFile()),
        'line'    => $e->getLine(),
        'trace'   => $e->getTraceAsString()
    ]);

    } else {

        http_response_code(500);

        if (
            isset($_SERVER['HTTP_ACCEPT']) &&
            str_contains($_SERVER['HTTP_ACCEPT'], 'application/json')
        ) {

            header('Content-Type: application/json');

            echo json_encode([
                'success' => false,
                'message' => 'Terjadi kesalahan pada sistem.'
            ]);

        } else {

            echo "Terjadi kesalahan pada sistem.";

        }
    }
});

set_error_handler(function (
    int $severity,
    string $message,
    string $file,
    int $line
) {

    throw new ErrorException(
        $message,
        0,
        $severity,
        $file,
        $line
    );

});
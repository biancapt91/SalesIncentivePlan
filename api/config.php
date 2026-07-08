<?php
// ================================================
//  e-SIP | Database Configuration
//  Sesuaikan DB_USER / DB_PASS jika berbeda
// ================================================

require_once __DIR__.'/../config/bootstrap.php';

// ================================================
//  Audit Log Helper
// ================================================

/**
 * Write an audit log entry.
 *
 * @param string $action      LOGIN | LOGOUT | VIEW | CREATE | UPDATE | DELETE
 * @param string $resource    Resource name, e.g. 'associates'
 * @param string $resourceId  Identifier of the affected record (optional)
 * @param string $details     Human-readable description (optional)
 */
function writeAuditLog(string $action, string $resource = '', string $resourceId = '', string $details = ''): void {
    if (session_status() === PHP_SESSION_NONE) {
        @session_start();
    }

    $username  = $_SESSION['esip_user']      ?? 'anonymous';
    $fullName  = $_SESSION['esip_full_name'] ?? '';
    $ipRaw     = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
    // Take first IP in case of proxy chain, validate format
    $ipParts   = explode(',', $ipRaw);
    $ip        = filter_var(trim($ipParts[0]), FILTER_VALIDATE_IP) ? trim($ipParts[0]) : '';

    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare(
            "INSERT INTO audit_logs (username, full_name, action, resource, resource_id, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute([$username, $fullName, strtoupper($action), $resource, $resourceId, $details ?: null, $ip]);
    } catch (\Throwable $e) {
        // Silently fail — audit logging must not break normal operation
        // Attempt auto-create table if it doesn't exist yet
        try {
            $pdo = getDB();
            $pdo->exec("CREATE TABLE IF NOT EXISTS `audit_logs` (
                `id`          BIGINT        NOT NULL AUTO_INCREMENT,
                `username`    VARCHAR(60)   NOT NULL,
                `full_name`   VARCHAR(100)  NOT NULL DEFAULT '',
                `action`      VARCHAR(30)   NOT NULL,
                `resource`    VARCHAR(60)   NOT NULL DEFAULT '',
                `resource_id` VARCHAR(80)   NOT NULL DEFAULT '',
                `details`     TEXT          NULL,
                `ip_address`  VARCHAR(45)   NOT NULL DEFAULT '',
                `created_at`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (`id`),
                KEY `idx_al_username`   (`username`),
                KEY `idx_al_action`     (`action`),
                KEY `idx_al_created_at` (`created_at`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            $stmt = $pdo->prepare(
                "INSERT INTO audit_logs (username, full_name, action, resource, resource_id, details, ip_address)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            );
            $stmt->execute([$username, $fullName, strtoupper($action), $resource, $resourceId, $details ?: null, $ip]);
        } catch (\Throwable $e2) { /* give up */ }
    }
}

function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=%s',
            DB_HOST, DB_PORT, DB_NAME, DB_CHARSET
        );
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_PERSISTENT         => true,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            logError($e);
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Terjadi kesalahan pada sistem.']);
            exit;
        }
    }
    return $pdo;
}

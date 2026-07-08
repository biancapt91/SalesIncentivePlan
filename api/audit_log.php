<?php
// ================================================
//  e-SIP | Audit Log API
//  GET  /api/audit_log.php             — list (admin only)
//  GET  /api/audit_log.php?action=stats — summary counts
// ================================================

ini_set('display_errors', 0);
error_reporting(0);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

require_once __DIR__ . '/config.php';

// ── Auth guard: main admin account only ────────
// Only the hardcoded 'admin' username can access audit logs
if (empty($_SESSION['esip_user']) || $_SESSION['esip_user'] !== 'admin' || ($_SESSION['esip_role'] ?? '') !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Access denied.']);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
    exit;
}

// ── Auto-create table ───────────────────────────
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
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error: ' . $e->getMessage()]);
    exit;
}

// ── Stats ───────────────────────────────────────
if ($action === 'stats') {
    try {
        $total  = (int) $pdo->query("SELECT COUNT(*) FROM audit_logs")->fetchColumn();
        $today  = (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE DATE(created_at) = CURDATE()")->fetchColumn();
        $logins = (int) $pdo->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'LOGIN'")->fetchColumn();

        $byAction = $pdo->query(
            "SELECT action, COUNT(*) AS cnt FROM audit_logs GROUP BY action ORDER BY cnt DESC"
        )->fetchAll();

        echo json_encode([
            'success'  => true,
            'total'    => $total,
            'today'    => $today,
            'logins'   => $logins,
            'byAction' => $byAction,
        ]);
    } catch (\PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'DB error.']);
    }
    exit;
}

// ── List ────────────────────────────────────────
// Query params
$page     = max(1, (int) ($_GET['page'] ?? 1));
$limit    = min(200, max(10, (int) ($_GET['limit'] ?? 50)));
$offset   = ($page - 1) * $limit;

$filterUser   = trim($_GET['username']   ?? '');
$filterAction = strtoupper(trim($_GET['action_filter'] ?? ''));
$filterRes    = trim($_GET['resource']   ?? '');
$filterDate   = trim($_GET['date']       ?? '');   // YYYY-MM-DD

$where  = [];
$params = [];

if ($filterUser !== '') {
    $where[]  = 'username LIKE ?';
    $params[] = '%' . $filterUser . '%';
}
if ($filterAction !== '' && $filterAction !== 'ALL') {
    $where[]  = 'action = ?';
    $params[] = $filterAction;
}
if ($filterRes !== '' && $filterRes !== 'ALL') {
    $where[]  = 'resource = ?';
    $params[] = $filterRes;
}
if ($filterDate !== '') {
    $where[]  = 'DATE(created_at) = ?';
    $params[] = $filterDate;
}

$whereClause = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

try {
    $countStmt = $pdo->prepare("SELECT COUNT(*) FROM audit_logs $whereClause");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $dataStmt = $pdo->prepare(
        "SELECT id, username, full_name, action, resource, resource_id, details, ip_address, created_at
         FROM audit_logs $whereClause
         ORDER BY created_at DESC
         LIMIT $limit OFFSET $offset"
    );
    $dataStmt->execute($params);
    $rows = $dataStmt->fetchAll();

    echo json_encode([
        'success'    => true,
        'total'      => $total,
        'page'       => $page,
        'limit'      => $limit,
        'totalPages' => (int) ceil($total / $limit),
        'data'       => $rows,
    ]);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'DB error.']);
}

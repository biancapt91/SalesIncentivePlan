<?php
// ================================================
//  e-SIP | Department Heads API
//  GET    — list all
//  POST   — create
//  PUT    ?id=n  — update
//  DELETE ?id=n  — delete
// ================================================
ob_start();
ini_set('display_errors', 0);
error_reporting(0);
session_start();
ob_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

require_once __DIR__ . '/config.php';

$pdo    = getDB();
$method = $_SERVER['REQUEST_METHOD'];

// Ensure table exists
$pdo->exec("
    CREATE TABLE IF NOT EXISTS `department_heads` (
        `id`          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `employee_id` VARCHAR(20)  NOT NULL COLLATE utf8mb4_unicode_ci,
        `full_name`   VARCHAR(150) NOT NULL,
        `position`    VARCHAR(150) NOT NULL,
        `salary`      DECIMAL(18,2) NOT NULL DEFAULT 0,
        `reporting_manager_id` VARCHAR(20) NULL,
        `created_at`  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
");

// Migration: add reporting_manager_id if not exists
$cols = $pdo->query("SHOW COLUMNS FROM `department_heads` LIKE 'reporting_manager_id'")->fetchAll();
if (count($cols) === 0) {
    $pdo->exec("ALTER TABLE `department_heads` ADD COLUMN `reporting_manager_id` VARCHAR(20) NULL AFTER `salary`");
}

// ── GET ──────────────────────────────────────
if ($method === 'GET') {
    $rows = $pdo->query("SELECT * FROM `department_heads` ORDER BY id ASC")->fetchAll();
    foreach ($rows as &$r) {
        $r['salary'] = (float)$r['salary'];
        $r['reporting_manager_id'] = $r['reporting_manager_id'] ?? null;
    }
    unset($r);
    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
}

// Guard: only admin can modify
if (empty($_SESSION['esip_user']) || $_SESSION['esip_user'] !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Forbidden.']);
    exit;
}

// ── POST create ──────────────────────────────
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $employee_id = trim($body['employee_id'] ?? '');
    $full_name   = trim($body['full_name']   ?? '');
    $position    = trim($body['position']    ?? '');
    $salary      = (float)($body['salary']   ?? 0);
    $reporting_manager_id = trim($body['reporting_manager_id'] ?? '') ?: null;

    if ($employee_id === '' || $full_name === '' || $position === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'ID, Full Name, dan Position wajib diisi.']);
        exit;
    }

    $stmt = $pdo->prepare("INSERT INTO `department_heads` (employee_id, full_name, position, salary, reporting_manager_id) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([$employee_id, $full_name, $position, $salary, $reporting_manager_id]);
    echo json_encode(['success' => true, 'id' => (int)$pdo->lastInsertId(), 'message' => 'Department Head berhasil ditambahkan.']);
    exit;
}

// ── PUT update ────────────────────────────────
if ($method === 'PUT') {
    $id   = (int)($_GET['id'] ?? 0);
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $employee_id = trim($body['employee_id'] ?? '');
    $full_name   = trim($body['full_name']   ?? '');
    $position    = trim($body['position']    ?? '');
    $salary      = (float)($body['salary']   ?? 0);
    $reporting_manager_id = trim($body['reporting_manager_id'] ?? '') ?: null;

    if ($id <= 0 || $employee_id === '' || $full_name === '' || $position === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap.']);
        exit;
    }

    $stmt = $pdo->prepare("UPDATE `department_heads` SET employee_id=?, full_name=?, position=?, salary=?, reporting_manager_id=? WHERE id=?");
    $stmt->execute([$employee_id, $full_name, $position, $salary, $reporting_manager_id, $id]);
    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }
    echo json_encode(['success' => true, 'message' => 'Department Head berhasil diperbarui.']);
    exit;
}

// ── DELETE ────────────────────────────────────
if ($method === 'DELETE') {
    $id = (int)($_GET['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id diperlukan.']);
        exit;
    }
    $stmt = $pdo->prepare("DELETE FROM `department_heads` WHERE id=?");
    $stmt->execute([$id]);
    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }
    echo json_encode(['success' => true, 'message' => 'Department Head berhasil dihapus.']);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method tidak diizinkan.']);

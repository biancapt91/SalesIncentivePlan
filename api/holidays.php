<?php
// ================================================
//  e-SIP | Holidays API
//  GET    — list all holidays
//  POST   — add holiday  (admin only)
//  PUT    — update holiday (admin only)
//  DELETE ?id=n — remove holiday (admin only)
// ================================================
ob_start();
ini_set('display_errors', 0);
error_reporting(0);
session_start();
ob_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/config.php';

// Migration: create holidays table if not exists
(function() {
    getDB()->exec("CREATE TABLE IF NOT EXISTS `holidays` (
        `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        `holiday_date` DATE          NOT NULL,
        `description`  VARCHAR(255)  NOT NULL DEFAULT '',
        PRIMARY KEY (`id`),
        UNIQUE KEY `uq_holiday_date` (`holiday_date`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
})();

$method = $_SERVER['REQUEST_METHOD'];

// ── GET — anyone authenticated ──
if ($method === 'GET') {
    $pdo  = getDB();
    $stmt = $pdo->query("SELECT id, holiday_date, description FROM holidays ORDER BY holiday_date ASC");
    echo json_encode(['success' => true, 'data' => $stmt->fetchAll()]);
    exit;
}

// ── Mutation: admin only ──
if (empty($_SESSION['esip_user']) || $_SESSION['esip_user'] !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Unauthorized']);
    exit;
}


// ── POST — add holiday ──
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $date = trim($body['holiday_date'] ?? '');
    $desc = trim($body['description']  ?? '');

    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        echo json_encode(['success' => false, 'message' => 'Format tanggal tidak valid (YYYY-MM-DD).']);
        exit;
    }
    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare("INSERT INTO holidays (holiday_date, description) VALUES (?, ?)");
        $stmt->execute([$date, $desc]);
        echo json_encode(['success' => true, 'message' => 'Hari libur ditambahkan.', 'id' => (int) $pdo->lastInsertId()]);
    } catch (\PDOException $e) {
        if ($e->getCode() === '23000') {
            echo json_encode(['success' => false, 'message' => 'Tanggal tersebut sudah terdaftar sebagai hari libur.']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
        }
    }
    exit;
}

// ── PUT — update holiday ──
if ($method === 'PUT') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $id   = (int)($_GET['id'] ?? ($body['id'] ?? 0));
    $date = trim($body['holiday_date'] ?? '');
    $desc = trim($body['description'] ?? '');
    if (!$id || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        echo json_encode(['success'=>false,'message'=>'Invalid input.']); exit;
    }
    try {
        $stmt = getDB()->prepare("UPDATE holidays SET holiday_date=?, description=? WHERE id=?");
        $stmt->execute([$date, $desc, $id]);
        echo json_encode(['success'=>true,'message'=>'Holiday updated.']);
    } catch (\PDOException $e) {
        $msg = $e->getCode() === '23000' ? 'Date already exists.' : 'DB error.';
        echo json_encode(['success'=>false,'message'=>$msg]);
    }
    exit;
}

// ── DELETE — remove holiday ──
if ($method === 'DELETE') {
    $id = (int) ($_GET['id'] ?? 0);
    if (!$id) {
        echo json_encode(['success' => false, 'message' => 'ID tidak ditemukan.']);
        exit;
    }
    $pdo  = getDB();
    $stmt = $pdo->prepare("DELETE FROM holidays WHERE id = ?");
    $stmt->execute([$id]);
    echo json_encode(['success' => true, 'message' => 'Hari libur dihapus.']);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

<?php
// ================================================
//  e-SIP | SIP Tiers Configuration API
//  GET           — return all tier configs (any authenticated user)
//  POST {tiers}  — save all tiers (admin only)
// ================================================
ob_start();
ini_set('display_errors', 0);
error_reporting(0);
session_start();
ob_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if (empty($_SESSION['esip_user'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Not authenticated.']);
    exit;
}

$loggedRole = $_SESSION['esip_role'] ?? 'sales_associate';
$isAdmin    = ($loggedRole === 'admin');

require_once __DIR__ . '/config.php';
$pdo = getDB();

// Hardcoded default tiers (fallback when DB has no override)
$defaults = [
    '3'  => ['base' => 3000000.0,   'inc85_100' => 200000.0,          'inc101_110' => 300000.0,          'max' => 10000000.0],
    '2L' => ['base' => 2000000.0,   'inc85_100' => 100000.0,          'inc101_110' => 125000.0,          'max' =>  5500000.0],
    '2'  => ['base' => 1000000.0,   'inc85_100' =>  50000.0,          'inc101_110' =>  87500.0,          'max' =>  3000000.0],
    '2T' => ['base' => 1000000.0,   'inc85_100' =>  33333.3333333333, 'inc101_110' =>  41666.6666666667, 'max' =>  2200000.0],
    '1T' => ['base' =>  500000.0,   'inc85_100' =>   8333.33333333333,'inc101_110' =>  12500.0,          'max' =>   900000.0],
    '1'  => ['base' =>  750000.0,   'inc85_100' =>  20833.3333333333, 'inc101_110' =>  31250.0,          'max' =>  1500000.0],
];

// Ensure table exists
$pdo->exec("
    CREATE TABLE IF NOT EXISTS `sip_tiers` (
        `plan`        VARCHAR(10)     NOT NULL PRIMARY KEY,
        `base`        DECIMAL(18,6)   NOT NULL,
        `inc85_100`   DECIMAL(18,10)  NOT NULL,
        `inc101_110`  DECIMAL(18,10)  NOT NULL,
        `max`         DECIMAL(18,6)   NOT NULL,
        `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: return merged tiers (DB values override defaults) ────────────────
if ($method === 'GET') {
    $tiers = $defaults;
    $rows  = $pdo->query("SELECT plan, base, inc85_100, inc101_110, max FROM sip_tiers")->fetchAll();
    foreach ($rows as $r) {
        if (isset($tiers[$r['plan']])) {
            $tiers[$r['plan']] = [
                'base'        => (float) $r['base'],
                'inc85_100'   => (float) $r['inc85_100'],
                'inc101_110'  => (float) $r['inc101_110'],
                'max'         => (float) $r['max'],
            ];
        }
    }
    echo json_encode(['success' => true, 'data' => $tiers]);
    exit;
}

// ── POST: save tiers (admin only) ─────────────────────────────────────────
if ($method === 'POST') {
    if (!$isAdmin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Hanya admin yang dapat mengubah konfigurasi Tiers.']);
        exit;
    }

    $body  = json_decode(file_get_contents('php://input'), true) ?? [];
    $input = $body['tiers'] ?? null;
    if (!is_array($input) || empty($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Data tiers tidak valid.']);
        exit;
    }

    $stmt = $pdo->prepare("
        INSERT INTO sip_tiers (plan, base, inc85_100, inc101_110, max, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
            base        = VALUES(base),
            inc85_100   = VALUES(inc85_100),
            inc101_110  = VALUES(inc101_110),
            max         = VALUES(max),
            updated_at  = NOW()
    ");

    $pdo->beginTransaction();
    try {
        foreach ($input as $planKey => $t) {
            if (!isset($defaults[$planKey])) continue; // reject unknown plans
            $base       = (float) ($t['base']       ?? 0);
            $inc85_100  = (float) ($t['inc85_100']  ?? 0);
            $inc101_110 = (float) ($t['inc101_110'] ?? 0);
            $max        = (float) ($t['max']        ?? 0);
            if ($base < 0 || $inc85_100 < 0 || $inc101_110 < 0 || $max < 0) {
                throw new Exception("Nilai tidak boleh negatif pada plan {$planKey}.");
            }
            $stmt->execute([$planKey, $base, $inc85_100, $inc101_110, $max]);
        }
        $pdo->commit();
        echo json_encode(['success' => true, 'message' => 'Konfigurasi Tiers berhasil disimpan.']);
    } catch (Exception $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

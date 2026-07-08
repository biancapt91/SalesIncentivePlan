<?php
// ================================================
//  e-SIP | SIP Payment Status API
//  GET  ?month=YYYY-MM              — status semua associate bulan tertentu
//  POST { employee_id, month }      — toggle paid/unpaid
// ================================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

// -----------------------------------------------
//  GET ?month=YYYY-MM
// -----------------------------------------------
if ($method === 'GET') {
    $pdo = getDB();

    // ── GET ?year=YYYY — all paid months for a whole year ──
    if (isset($_GET['year']) && !isset($_GET['month'])) {
        $year = (int) ($_GET['year'] ?? date('Y'));
        $stmt = $pdo->prepare(
            "SELECT employee_id, month FROM sip_payment
             WHERE is_paid = 1 AND month LIKE ?
             ORDER BY month"
        );
        $stmt->execute([$year . '-%']);
        $rows = $stmt->fetchAll();
        // Return as: { employee_id: [month, ...] }
        $map = [];
        foreach ($rows as $r) {
            $map[$r['employee_id']][] = $r['month'];
        }
        echo json_encode(['success' => true, 'data' => $map]);
        exit;
    }

    // ── GET ?month=YYYY-MM — status per month ──
    $month = trim($_GET['month'] ?? '');
    if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Format bulan tidak valid (YYYY-MM).']);
        exit;
    }

    $stmt = $pdo->prepare(
        "SELECT employee_id, is_paid, paid_at FROM sip_payment WHERE month = ?"
    );
    $stmt->execute([$month]);
    $rows = $stmt->fetchAll();

    $map = [];
    foreach ($rows as $r) {
        $map[$r['employee_id']] = [
            'is_paid' => (bool) $r['is_paid'],
            'paid_at' => $r['paid_at'],
        ];
    }
    echo json_encode(['success' => true, 'data' => $map]);
    exit;
}

// -----------------------------------------------
//  POST — toggle paid status
// -----------------------------------------------
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    $empId = trim($body['employee_id'] ?? '');
    $month = trim($body['month'] ?? '');

    if ($empId === '' || !preg_match('/^\d{4}-\d{2}$/', $month)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'employee_id dan month (YYYY-MM) wajib diisi.']);
        exit;
    }

    $pdo = getDB();

    // Ambil status saat ini
    $sel = $pdo->prepare("SELECT is_paid FROM sip_payment WHERE employee_id = ? AND month = ?");
    $sel->execute([$empId, $month]);
    $existing = $sel->fetch();

    if ($existing === false) {
        // Belum ada → insert sebagai paid
        $ins = $pdo->prepare(
            "INSERT INTO sip_payment (employee_id, month, is_paid, paid_at) VALUES (?, ?, 1, NOW())"
        );
        $ins->execute([$empId, $month]);
        $isPaid = true;
    } else {
        // Toggle
        $newVal = $existing['is_paid'] ? 0 : 1;
        $upd = $pdo->prepare(
            "UPDATE sip_payment SET is_paid = ?, paid_at = ? WHERE employee_id = ? AND month = ?"
        );
        $upd->execute([$newVal, $newVal ? date('Y-m-d H:i:s') : null, $empId, $month]);
        $isPaid = (bool) $newVal;
    }

    echo json_encode(['success' => true, 'is_paid' => $isPaid]);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

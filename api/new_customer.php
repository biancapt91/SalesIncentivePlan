<?php
// ================================================
//  e-SIP | New Customer Achievement API
//  GET    ?employee_id=xxx              — per associate (detail modal)
//  GET    ?month=YYYY-MM                — semua associate bulan tertentu (summary)
//  POST                                 — tambah entry + customer names
//  DELETE ?id=xxx                       — hapus 1 entry
// ================================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

// -----------------------------------------------
//  GET — per employee atau per bulan
// -----------------------------------------------
if ($method === 'GET') {
    $pdo   = getDB();
    $empId = trim($_GET['employee_id'] ?? '');
    $month = trim($_GET['month'] ?? '');

    // GET ?employee_id=xxx&group=month  → grouped by month
    if ($empId !== '' && trim($_GET['group'] ?? '') === 'month') {
        $stmt = $pdo->prepare(
            "SELECT month_key,
                    SUM(actual_new_customer) AS actual_new_customer,
                    GROUP_CONCAT(customer_names SEPARATOR '||') AS customer_names
             FROM (
                 SELECT DATE_FORMAT(a.invoice_date, '%Y-%m') AS month_key,
                        a.actual_new_customer,
                        GROUP_CONCAT(n.customer_name ORDER BY n.id SEPARATOR '||') AS customer_names
                 FROM new_customer_achievement a
                 LEFT JOIN new_customer_names n ON n.achievement_id = a.id
                 WHERE a.employee_id = ?
                 GROUP BY a.id, a.invoice_date, a.actual_new_customer
             ) sub
             GROUP BY month_key
             ORDER BY month_key DESC"
        );
        $stmt->execute([$empId]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['actual_new_customer'] = (int) $r['actual_new_customer'];
            $r['customer_names']      = $r['customer_names'] ? explode('||', $r['customer_names']) : [];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    // GET ?employee_id=xxx [&month=YYYY-MM]  → detail per pegawai (optional bulan)
    if ($empId !== '') {
        $params    = [$empId];
        $monthCond = '';
        if ($month !== '' && preg_match('/^\d{4}-\d{2}$/', $month)) {
            $monthCond = "AND DATE_FORMAT(a.invoice_date, '%Y-%m') = ?";
            $params[]  = $month;
        }

        $stmt = $pdo->prepare(
            "SELECT a.id, a.invoice_date, a.actual_new_customer,
                    GROUP_CONCAT(n.customer_name ORDER BY n.id SEPARATOR '||') AS customer_names
             FROM new_customer_achievement a
             LEFT JOIN new_customer_names n ON n.achievement_id = a.id
             WHERE a.employee_id = ? $monthCond
             GROUP BY a.id, a.invoice_date, a.actual_new_customer
             ORDER BY a.invoice_date DESC, a.id DESC"
        );
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id']                  = (int) $r['id'];
            $r['actual_new_customer'] = (int) $r['actual_new_customer'];
            $r['customer_names']      = $r['customer_names'] ? explode('||', $r['customer_names']) : [];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    // GET ?month=YYYY-MM  → aggregate untuk summary
    if ($month !== '') {
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Format bulan tidak valid (YYYY-MM).']);
            exit;
        }

        $stmt = $pdo->prepare(
            "SELECT employee_id,
                    SUM(actual_new_customer) AS actual_new_customer
             FROM new_customer_achievement
             WHERE DATE_FORMAT(invoice_date, '%Y-%m') = ?
             GROUP BY employee_id"
        );
        $stmt->execute([$month]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['actual_new_customer'] = (int) $r['actual_new_customer'];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Parameter employee_id atau month diperlukan.']);
    exit;
}

// -----------------------------------------------
//  POST — tambah achievement
// -----------------------------------------------
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    if (!is_array($body) || empty($body['employee_id']) || empty($body['invoice_date'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'employee_id dan invoice_date wajib diisi.']);
        exit;
    }

    // Validasi tanggal
    $date = \DateTime::createFromFormat('Y-m-d', $body['invoice_date']);
    if (!$date || $date->format('Y-m-d') !== $body['invoice_date']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Format tanggal tidak valid (YYYY-MM-DD).']);
        exit;
    }

    $actual       = max(0, (int)($body['actual_new_customer'] ?? 0));
    $customerList = isset($body['customer_names']) && is_array($body['customer_names'])
                    ? array_filter(array_map('trim', $body['customer_names']), fn($s) => $s !== '')
                    : [];

    $pdo = getDB();

    // Pastikan employee ada
    $chk = $pdo->prepare('SELECT id FROM associates WHERE employee_id = ?');
    $chk->execute([trim($body['employee_id'])]);
    if (!$chk->fetch()) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Associate tidak ditemukan.']);
        exit;
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO new_customer_achievement (employee_id, invoice_date, actual_new_customer) VALUES (?, ?, ?)'
        );
        $stmt->execute([
            sanitize($body['employee_id']),
            $body['invoice_date'],
            $actual,
        ]);
        $achId = (int) $pdo->lastInsertId();

        if (!empty($customerList)) {
            $ins = $pdo->prepare('INSERT INTO new_customer_names (achievement_id, customer_name) VALUES (?, ?)');
            foreach ($customerList as $name) {
                $ins->execute([$achId, sanitize($name)]);
            }
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Gagal menyimpan: ' . $e->getMessage()]);
        exit;
    }

    http_response_code(201);
    echo json_encode(['success' => true, 'message' => 'Data berhasil disimpan.', 'id' => $achId]);
    exit;
}

// -----------------------------------------------
//  DELETE — hapus 1 entry
// -----------------------------------------------
if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id tidak valid.']);
        exit;
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare('DELETE FROM new_customer_achievement WHERE id = ?');
    $stmt->execute([$id]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }

    echo json_encode(['success' => true, 'message' => 'Data berhasil dihapus.']);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method tidak diizinkan.']);

function sanitize(string $value): string {
    return strip_tags(trim($value));
}

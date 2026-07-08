<?php
// ================================================
//  e-SIP | Associates API
//  GET    /api/associates.php              — ambil semua
//  POST   /api/associates.php              — tambah baru
//  PUT    /api/associates.php?id=xxx       — edit
//  PATCH  /api/associates.php?id=xxx       — resign / reaktivasi
//  DELETE /api/associates.php?id=xxx       — hapus
// ================================================

ini_set('display_errors', 0);
error_reporting(0);
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Tangani preflight request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

// Migration: add join_date column if not present
(function() {
    $pdo = getDB();
    if (!$pdo->query("SHOW COLUMNS FROM `associates` LIKE 'join_date'")->fetch()) {
        try { $pdo->exec("ALTER TABLE `associates` ADD COLUMN `join_date` DATE NULL DEFAULT NULL"); } catch (\PDOException $e) {}
    }
})();

$method = $_SERVER['REQUEST_METHOD'];

// -----------------------------------------------
//  GET — Ambil semua associate
// -----------------------------------------------
if ($method === 'GET') {
  try {
    $pdo = getDB();

    // Base query — with dept-head JOIN for manager name lookup
    $sql = 'SELECT a.employee_id, a.full_name, a.position, a.level, a.category, a.plan,
                a.detail_area, a.group_area, a.salary, a.target_nc,
                a.sip_budget_jan, a.sip_budget_feb, a.sip_budget_mar, a.sip_budget_apr,
                a.sip_budget_may, a.sip_budget_jun, a.sip_budget_jul, a.sip_budget_aug,
                a.sip_budget_sep, a.sip_budget_oct, a.sip_budget_nov, a.sip_budget_dec,
                a.current_sip_percent, a.resign_date, a.join_date,
                a.reporting_manager_id,
                COALESCE(m.full_name, dh.full_name) AS reporting_manager_name,
                COALESCE(
                    (SELECT h.sip_budget
                     FROM employment_history h
                     WHERE h.employee_id = a.employee_id
                       AND h.effective_date <= LAST_DAY(CURDATE())
                     ORDER BY h.effective_date DESC
                     LIMIT 1),
                    0
                ) AS sip_budget_current
         FROM associates a
         LEFT JOIN associates m ON m.employee_id = a.reporting_manager_id
         LEFT JOIN department_heads dh ON dh.employee_id COLLATE utf8mb4_unicode_ci = a.reporting_manager_id
         ORDER BY a.id ASC';

    // Fallback query without dept-head JOIN (used if department_heads table doesn't exist yet)
    $sqlFallback = 'SELECT a.employee_id, a.full_name, a.position, a.level, a.category, a.plan,
                a.detail_area, a.group_area, a.salary, a.target_nc,
                a.sip_budget_jan, a.sip_budget_feb, a.sip_budget_mar, a.sip_budget_apr,
                a.sip_budget_may, a.sip_budget_jun, a.sip_budget_jul, a.sip_budget_aug,
                a.sip_budget_sep, a.sip_budget_oct, a.sip_budget_nov, a.sip_budget_dec,
                a.current_sip_percent, a.resign_date, a.join_date,
                a.reporting_manager_id,
                m.full_name AS reporting_manager_name,
                COALESCE(
                    (SELECT h.sip_budget
                     FROM employment_history h
                     WHERE h.employee_id = a.employee_id
                       AND h.effective_date <= LAST_DAY(CURDATE())
                     ORDER BY h.effective_date DESC
                     LIMIT 1),
                    0
                ) AS sip_budget_current
         FROM associates a
         LEFT JOIN associates m ON m.employee_id = a.reporting_manager_id
         ORDER BY a.id ASC';

    try {
        $stmt = $pdo->query($sql);
    } catch (\PDOException $e) {
        // department_heads table not yet created — use fallback
        $stmt = $pdo->query($sqlFallback);
    }
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['salary']              = (float) $row['salary'];
        $row['target_nc']           = (int)   $row['target_nc'];
        $row['current_sip_percent'] = (float) $row['current_sip_percent'];
        $row['category']            = (string) ($row['category'] ?? '');
        $row['plan']                = (string) ($row['plan'] ?? '');
        $row['sip_budget_current']  = (float) $row['sip_budget_current'];
        $row['resign_date']          = $row['resign_date'] ?? null;
        $row['join_date']             = $row['join_date']   ?? null;
        $row['reporting_manager_id']   = $row['reporting_manager_id']   ?? null;
        $row['reporting_manager_name'] = $row['reporting_manager_name'] ?? null;
        foreach (MONTHS as $m) {
            $row['sip_budget_' . $m] = (float) $row['sip_budget_' . $m];
        }
    }
    unset($row);

    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
  } catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    exit;
  }
}

// -----------------------------------------------
//  POST — Tambah associate baru
// -----------------------------------------------
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    if (!validatePayload($body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap.']);
        exit;
    }

    $pdo = getDB();

    // Cek duplikat employee_id
    $chk = $pdo->prepare('SELECT id FROM associates WHERE employee_id = ?');
    $chk->execute([$body['employee_id']]);
    if ($chk->fetch()) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'ID pegawai sudah digunakan.']);
        exit;
    }

    $budgetCols = implode(', ', array_map(fn($m) => "sip_budget_$m", MONTHS));
    $budgetPH   = implode(', ', array_fill(0, 12, '?'));

    $stmt = $pdo->prepare(
        "INSERT INTO associates
            (employee_id, full_name, position, level, category, plan, detail_area, group_area, salary, target_nc, $budgetCols, current_sip_percent, resign_date, join_date, reporting_manager_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, $budgetPH, ?, ?, ?, ?)"
    );
    $params = [
        sanitize($body['employee_id']),
        sanitize($body['full_name']),
        sanitize($body['position']),
        sanitize($body['level'] ?? ''),
        sanitize($body['category'] ?? ''),
        sanitize($body['plan'] ?? ''),
        sanitize($body['detail_area']),
        sanitize($body['group_area']),
        (float) $body['salary'],
        (int)   $body['target_nc'],
    ];
    foreach (MONTHS as $m) {
        $params[] = isset($body['sip_budget_' . $m]) ? (float)$body['sip_budget_' . $m] : 0.0;
    }
    $params[] = (float) ($body['current_sip_percent'] ?? 0.0);
    $params[] = null; // resign_date default NULL
    $params[] = isset($body['join_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $body['join_date']) ? $body['join_date'] : null;
    $params[] = !empty($body['reporting_manager_id']) ? sanitize($body['reporting_manager_id']) : null;
    $stmt->execute($params);

    writeAuditLog('CREATE', 'associates', sanitize($body['employee_id']), 'Tambah associate: ' . sanitize($body['full_name']));
    http_response_code(201);
    echo json_encode(['success' => true, 'message' => 'Associate berhasil ditambahkan.']);
    exit;
}

// -----------------------------------------------
//  PUT — Edit associate (by employee_id di query string)
// -----------------------------------------------
if ($method === 'PUT') {
    $empId = isset($_GET['id']) ? trim($_GET['id']) : '';
    if ($empId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id diperlukan.']);
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true);

    if (!validatePayload($body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap.']);
        exit;
    }

    $pdo = getDB();

    // Jika employee_id berubah, cek duplikat pada ID baru
    $newId = sanitize($body['employee_id']);
    if ($newId !== $empId) {
        $chk = $pdo->prepare('SELECT id FROM associates WHERE employee_id = ?');
        $chk->execute([$newId]);
        if ($chk->fetch()) {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'ID pegawai sudah digunakan.']);
            exit;
        }
    }

    $budgetSet = implode(', ', array_map(fn($m) => "sip_budget_$m = ?", MONTHS));

    $stmt = $pdo->prepare(
        "UPDATE associates
         SET employee_id = ?, full_name = ?, position = ?, level = ?, category = ?, plan = ?,
             detail_area = ?, group_area = ?, salary = ?,
             target_nc = ?, $budgetSet, current_sip_percent = ?, join_date = ?, reporting_manager_id = ?
         WHERE employee_id = ?"
    );
    $params = [
        $newId,
        sanitize($body['full_name']),
        sanitize($body['position']),
        sanitize($body['level'] ?? ''),
        sanitize($body['category'] ?? ''),
        sanitize($body['plan'] ?? ''),
        sanitize($body['detail_area']),
        sanitize($body['group_area']),
        (float) $body['salary'],
        (int)   $body['target_nc'],
    ];
    foreach (MONTHS as $m) {
        $params[] = isset($body['sip_budget_' . $m]) ? (float)$body['sip_budget_' . $m] : 0.0;
    }
    $params[] = (float) ($body['current_sip_percent'] ?? 0.0);
    $params[] = isset($body['join_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $body['join_date']) ? $body['join_date'] : null;
    $params[] = !empty($body['reporting_manager_id']) ? sanitize($body['reporting_manager_id']) : null;
    $params[] = $empId;
    $stmt->execute($params);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }

    writeAuditLog('UPDATE', 'associates', $empId, 'Update associate: ' . sanitize($body['full_name']));
    echo json_encode(['success' => true, 'message' => 'Associate berhasil diperbarui.']);
    exit;
}

// -----------------------------------------------
//  DELETE — Hapus associate (by employee_id)
// -----------------------------------------------
if ($method === 'DELETE') {
    $empId = isset($_GET['id']) ? trim($_GET['id']) : '';
    if ($empId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id diperlukan.']);
        exit;
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare('DELETE FROM associates WHERE employee_id = ?');
    $stmt->execute([$empId]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }

    writeAuditLog('DELETE', 'associates', $empId, 'Hapus associate: ' . $empId);
    echo json_encode(['success' => true, 'message' => 'Associate berhasil dihapus.']);
    exit;
}

// -----------------------------------------------
//  PATCH — Resign / Reaktivasi associate
// -----------------------------------------------
if ($method === 'PATCH') {
    $empId = isset($_GET['id']) ? trim($_GET['id']) : '';
    if ($empId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id diperlukan.']);
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Body tidak valid.']);
        exit;
    }

    $pdo = getDB();

    // action = 'resign'  → set resign_date
    // action = 'reactivate' → clear resign_date
    $action = $body['action'] ?? '';

    if ($action === 'resign') {
        $resignDate = isset($body['resign_date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $body['resign_date'])
            ? $body['resign_date'] : null;
        if (!$resignDate) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Tanggal resign tidak valid.']);
            exit;
        }
        $stmt = $pdo->prepare('UPDATE associates SET resign_date = ? WHERE employee_id = ?');
        $stmt->execute([$resignDate, $empId]);
        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
            exit;
        }
        writeAuditLog('UPDATE', 'associates', $empId, 'Resign associate: ' . $empId . ' (tanggal: ' . $resignDate . ')');
        echo json_encode(['success' => true, 'message' => 'Associate berhasil dinonaktifkan.']);
        exit;
    }

    if ($action === 'reactivate') {
        $stmt = $pdo->prepare('UPDATE associates SET resign_date = NULL WHERE employee_id = ?');
        $stmt->execute([$empId]);
        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
            exit;
        }
        writeAuditLog('UPDATE', 'associates', $empId, 'Reaktivasi associate: ' . $empId);
        echo json_encode(['success' => true, 'message' => 'Associate berhasil diaktifkan kembali.']);
        exit;
    }

    if ($action === 'update_info') {
        $stmt = $pdo->prepare(
            'UPDATE associates SET position = ?, level = ?, category = ?, plan = ?, salary = ? WHERE employee_id = ?'
        );
        $stmt->execute([
            sanitize($body['position'] ?? ''),
            sanitize($body['level']    ?? ''),
            sanitize($body['category'] ?? ''),
            sanitize($body['plan']     ?? ''),
            isset($body['salary']) ? (float)$body['salary'] : 0.0,
            $empId,
        ]);
        echo json_encode(['success' => true, 'message' => 'Info associate diperbarui.']);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Action tidak dikenali. Gunakan resign atau reactivate.']);
    exit;
}

// -----------------------------------------------
//  Method tidak didukung
// -----------------------------------------------
http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method tidak diizinkan.']);

// ================================================
//  HELPERS
// ================================================
function sanitize(string $value): string {
    return strip_tags(trim($value));
}

function validatePayload(?array $body): bool {
    if (!is_array($body)) return false;
    $required = ['employee_id', 'full_name', 'position', 'level', 'category', 'plan', 'detail_area', 'group_area', 'salary', 'target_nc'];
    foreach ($required as $field) {
        if (!isset($body[$field]) || (string)$body[$field] === '') return false;
    }
    return true;
}
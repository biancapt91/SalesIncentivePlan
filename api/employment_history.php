<?php
// ================================================
//  e-SIP | Employment History API
//  GET    /api/employment_history.php?employee_id=xxx  — riwayat 1 pegawai
//  POST   /api/employment_history.php                  — tambah riwayat
//  PUT    /api/employment_history.php?id=xxx           — edit riwayat
//  DELETE /api/employment_history.php?id=xxx           — hapus 1 baris
// ================================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

// -----------------------------------------------
//  GET — Ambil riwayat pegawai
// -----------------------------------------------
if ($method === 'GET') {
    $pdo = getDB();

    // ── GET ?year=YYYY&per_month=1 — budget per month per associate ──
    if (isset($_GET['per_month']) && isset($_GET['year'])) {
        $year = (int) ($_GET['year'] ?? date('Y'));
        $monthKeys = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

        $stmt = $pdo->prepare(
            'SELECT employee_id, sip_budget, level, position, category, plan, salary, effective_date
             FROM employment_history
             ORDER BY employee_id, effective_date ASC'
        );
        $stmt->execute();
        $rows = $stmt->fetchAll();

        $rStmt = $pdo->query('SELECT employee_id, resign_date, level, position, category, plan, salary FROM associates');
        $resignMap          = [];
        $currentLevelMap    = [];
        $currentPositionMap = [];
        $currentCategoryMap = [];
        $currentPlanMap     = [];
        $currentSalaryMap   = [];
        foreach ($rStmt->fetchAll() as $r) {
            $resignMap[$r['employee_id']]          = $r['resign_date'];
            $currentLevelMap[$r['employee_id']]    = $r['level'];
            $currentPositionMap[$r['employee_id']] = $r['position'];
            $currentCategoryMap[$r['employee_id']] = $r['category'];
            $currentPlanMap[$r['employee_id']]     = $r['plan'];
            $currentSalaryMap[$r['employee_id']]   = $r['salary'];
        }

        $histMap = [];
        foreach ($rows as $r) {
            $histMap[$r['employee_id']][] = [
                'sip_budget'     => (float) $r['sip_budget'],
                'level'          => $r['level'],
                'position'       => $r['position'],
                'category'       => $r['category'],
                'plan'           => $r['plan'],
                'salary'         => (float) $r['salary'],
                'effective_date' => $r['effective_date'],
            ];
        }

        $result     = [];
        $levels     = [];
        $positions  = [];
        $plans      = [];
        $categories = [];
        $salaries   = [];
        foreach ($histMap as $empId => $records) {
            $resignDate       = isset($resignMap[$empId]) ? $resignMap[$empId] : null;
            $resignMonthStart = $resignDate ? substr($resignDate, 0, 7) . '-01' : null;
            $result[$empId]     = [];
            $levels[$empId]     = [];
            $positions[$empId]  = [];
            $plans[$empId]      = [];
            $categories[$empId] = [];
            $salaries[$empId]   = [];
            for ($m = 1; $m <= 12; $m++) {
                $key        = $monthKeys[$m - 1];
                $monthStart = date('Y-m-d', mktime(0, 0, 0, $m, 1, $year));
                if ($resignMonthStart !== null && $monthStart >= $resignMonthStart) {
                    $result[$empId][$key]     = 0;
                    $levels[$empId][$key]     = $currentLevelMap[$empId]    ?? null;
                    $positions[$empId][$key]  = $currentPositionMap[$empId] ?? null;
                    $plans[$empId][$key]      = $currentPlanMap[$empId]     ?? null;
                    $categories[$empId][$key] = $currentCategoryMap[$empId] ?? null;
                    $salaries[$empId][$key]   = isset($currentSalaryMap[$empId]) ? (float)$currentSalaryMap[$empId] : 0;
                    continue;
                }
                $lastDay    = date('Y-m-d', mktime(0, 0, 0, $m + 1, 0, $year));
                $applicable = null;
                foreach ($records as $rec) {
                    if ($rec['effective_date'] <= $lastDay) $applicable = $rec;
                }
                $result[$empId][$key]     = $applicable ? $applicable['sip_budget'] : 0;
                $levels[$empId][$key]     = ($applicable && $applicable['level'])
                    ? $applicable['level']
                    : ($currentLevelMap[$empId] ?? null);
                $positions[$empId][$key]  = ($applicable && $applicable['position'])
                    ? $applicable['position']
                    : ($currentPositionMap[$empId] ?? null);
                $plans[$empId][$key]      = ($applicable && $applicable['plan'])
                    ? $applicable['plan']
                    : ($currentPlanMap[$empId] ?? null);
                $categories[$empId][$key] = ($applicable && $applicable['category'])
                    ? $applicable['category']
                    : ($currentCategoryMap[$empId] ?? null);
                $salaries[$empId][$key]   = $applicable
                    ? (float)$applicable['salary']
                    : (isset($currentSalaryMap[$empId]) ? (float)$currentSalaryMap[$empId] : 0);
            }
        }
        echo json_encode(['success' => true, 'data' => $result, 'levels' => $levels,
            'positions' => $positions, 'plans' => $plans, 'categories' => $categories, 'salaries' => $salaries]);
        exit;
    }

    // ── GET ?year=YYYY&summary=1 — annual budget total per associate ──
    if (isset($_GET['summary']) && isset($_GET['year'])) {
        $year = (int) ($_GET['year'] ?? date('Y'));

        // Fetch all employment history ordered ascending
        $stmt = $pdo->prepare(
            'SELECT employee_id, sip_budget, effective_date
             FROM employment_history
             ORDER BY employee_id, effective_date ASC'
        );
        $stmt->execute();
        $rows = $stmt->fetchAll();

        // Fetch resign_date per associate
        $rStmt = $pdo->query('SELECT employee_id, resign_date FROM associates');
        $resignMap = [];
        foreach ($rStmt->fetchAll() as $r) {
            $resignMap[$r['employee_id']] = $r['resign_date']; // NULL or 'YYYY-MM-DD'
        }

        // Group history by employee_id
        $histMap = [];
        foreach ($rows as $r) {
            $histMap[$r['employee_id']][] = [
                'sip_budget'     => (float) $r['sip_budget'],
                'effective_date' => $r['effective_date'],
            ];
        }

        $result = [];
        foreach ($histMap as $empId => $records) {
            $annual = 0;
            // resign_date: the month of resign is zeroed (budget only up to month before)
            $resignDate  = isset($resignMap[$empId]) ? $resignMap[$empId] : null;
            $resignMonthStart = $resignDate
                ? substr($resignDate, 0, 7) . '-01'  // 'YYYY-MM-01' of resign month
                : null;

            for ($m = 1; $m <= 12; $m++) {
                $monthStart = date('Y-m-d', mktime(0, 0, 0, $m, 1, $year));
                // Zero out the resign month and all months after
                if ($resignMonthStart !== null && $monthStart >= $resignMonthStart) {
                    continue;
                }
                $lastDay    = date('Y-m-d', mktime(0, 0, 0, $m + 1, 0, $year));
                $applicable = null;
                foreach ($records as $rec) {
                    if ($rec['effective_date'] <= $lastDay) $applicable = $rec;
                }
                $annual += $applicable ? $applicable['sip_budget'] : 0;
            }
            $result[$empId] = $annual;
        }
        echo json_encode(['success' => true, 'data' => $result]);
        exit;
    }

    // ── GET ?employee_id=xxx — riwayat 1 pegawai ──
    $empId = isset($_GET['employee_id']) ? trim($_GET['employee_id']) : '';
    if ($empId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter employee_id diperlukan.']);
        exit;
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare(
        'SELECT id, position, level, category, plan, salary, sip_budget, effective_date, notes
         FROM employment_history
         WHERE employee_id = ?
         ORDER BY effective_date DESC, id DESC'
    );
    $stmt->execute([$empId]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        $row['id']         = (int)   $row['id'];
        $row['salary']     = (float) $row['salary'];
        $row['sip_budget'] = (float) $row['sip_budget'];
    }
    unset($row);

    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
}

// -----------------------------------------------
//  POST — Tambah riwayat baru
// -----------------------------------------------
if ($method === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    if (!is_array($body) ||
        empty($body['employee_id']) ||
        empty($body['position'])    ||
        empty($body['effective_date'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Field employee_id, position, dan effective_date wajib diisi.']);
        exit;
    }

    // Validasi format tanggal
    $date = \DateTime::createFromFormat('Y-m-d', $body['effective_date']);
    if (!$date || $date->format('Y-m-d') !== $body['effective_date']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Format tanggal tidak valid (YYYY-MM-DD).']);
        exit;
    }

    // Pastikan employee_id ada
    $pdo = getDB();
    $chk = $pdo->prepare('SELECT id FROM associates WHERE employee_id = ?');
    $chk->execute([trim($body['employee_id'])]);
    if (!$chk->fetch()) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Associate tidak ditemukan.']);
        exit;
    }

    $stmt = $pdo->prepare(
        'INSERT INTO employment_history (employee_id, position, level, category, plan, salary, sip_budget, effective_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        sanitize($body['employee_id']),
        sanitize($body['position']),
        sanitize($body['level']    ?? ''),
        sanitize($body['category'] ?? ''),
        sanitize($body['plan']     ?? ''),
        isset($body['salary'])     ? (float)$body['salary']     : 0.0,
        isset($body['sip_budget']) ? (float)$body['sip_budget'] : 0.0,
        $body['effective_date'],
        sanitize($body['notes'] ?? ''),
    ]);

    $inserted = (int) $pdo->lastInsertId();
    http_response_code(201);
    echo json_encode(['success' => true, 'message' => 'Riwayat berhasil ditambahkan.', 'id' => $inserted]);
    exit;
}

// -----------------------------------------------
//  PUT — Edit riwayat by id
// -----------------------------------------------
if ($method === 'PUT') {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id tidak valid.']);
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true);

    if (!is_array($body) ||
        empty($body['position'])    ||
        empty($body['effective_date'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Field position dan effective_date wajib diisi.']);
        exit;
    }

    $date = \DateTime::createFromFormat('Y-m-d', $body['effective_date']);
    if (!$date || $date->format('Y-m-d') !== $body['effective_date']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Format tanggal tidak valid (YYYY-MM-DD).']);
        exit;
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare(
        'UPDATE employment_history
         SET position = ?, level = ?, category = ?, plan = ?, salary = ?, sip_budget = ?, effective_date = ?, notes = ?
         WHERE id = ?'
    );
    $stmt->execute([
        sanitize($body['position']),
        sanitize($body['level']    ?? ''),
        sanitize($body['category'] ?? ''),
        sanitize($body['plan']     ?? ''),
        isset($body['salary'])     ? (float)$body['salary']     : 0.0,
        isset($body['sip_budget']) ? (float)$body['sip_budget'] : 0.0,
        $body['effective_date'],
        sanitize($body['notes'] ?? ''),
        $id,
    ]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }

    echo json_encode(['success' => true, 'message' => 'Riwayat berhasil diperbarui.']);
    exit;
}

// -----------------------------------------------
//  DELETE — Hapus 1 baris riwayat by id
// -----------------------------------------------
if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Parameter id tidak valid.']);
        exit;
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare('DELETE FROM employment_history WHERE id = ?');
    $stmt->execute([$id]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Data tidak ditemukan.']);
        exit;
    }

    echo json_encode(['success' => true, 'message' => 'Riwayat berhasil dihapus.']);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method tidak diizinkan.']);

// ================================================
//  HELPERS
// ================================================
function sanitize(string $value): string {
    return strip_tags(trim($value));
}

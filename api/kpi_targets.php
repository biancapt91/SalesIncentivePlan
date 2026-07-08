<?php
// ================================================
//  e-SIP | KPI Targets API
//  GET  ?employee_id=xxx&year=YYYY  — semua komponen untuk satu pegawai/tahun
//  POST { employee_id, year, component, jan..dec } — upsert satu baris
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
$months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec_val'];
// Map from JS key → DB column
$monthMap = ['jan'=>'jan','feb'=>'feb','mar'=>'mar','apr'=>'apr','may'=>'may',
             'jun'=>'jun','jul'=>'jul','aug'=>'aug','sep'=>'sep','oct'=>'oct',
             'nov'=>'nov','dec'=>'dec_val'];

// -----------------------------------------------
//  GET
// -----------------------------------------------
if ($method === 'GET') {
    $empId = trim($_GET['employee_id'] ?? '');
    $year  = (int) ($_GET['year'] ?? date('Y'));
    if ($empId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'employee_id wajib diisi.']);
        exit;
    }

    $pdo  = getDB();
    $stmt = $pdo->prepare(
        "SELECT component, weight, jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec_val
         FROM kpi_targets WHERE employee_id = ? AND year = ?"
    );
    // Fetch using DB column names, but return as JS keys
    $stmt->execute([$empId, $year]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        // rename dec_val → dec for JS
        $r['dec'] = (float) ($r['dec_val'] ?? 0);
        unset($r['dec_val']);
        $r['weight'] = (float) $r['weight'];
        foreach (['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov'] as $m) {
            $r[$m] = (float) $r[$m];
        }
    }
    unset($r);
    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
}

// -----------------------------------------------
//  POST — upsert satu komponen
// -----------------------------------------------
if ($method === 'POST') {
    $body      = json_decode(file_get_contents('php://input'), true);
    $empId     = trim($body['employee_id'] ?? '');
    $year      = (int) ($body['year'] ?? 0);
    $component = trim($body['component'] ?? '');

    if ($empId === '' || $year < 2000 || $component === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'employee_id, year, dan component wajib diisi.']);
        exit;
    }

    $weight = (float) ($body['weight'] ?? 0);

    $vals = [];
    foreach ($monthMap as $jsKey => $dbCol) {
        $vals[$dbCol] = (float) ($body[$jsKey] ?? 0);
    }

    $pdo = getDB();
    $dbCols     = array_keys($vals);
    $setClauses = 'weight = ?, ' . implode(', ', array_map(fn($c) => "$c = ?", $dbCols));
    $colList    = 'weight,' . implode(',', $dbCols);
    $placeholders = implode(',', array_fill(0, count($dbCols) + 1, '?'));
    $stmt = $pdo->prepare(
        "INSERT INTO kpi_targets (employee_id, year, component, $colList)
         VALUES (?, ?, ?, $placeholders)
         ON DUPLICATE KEY UPDATE $setClauses"
    );
    $params = [$empId, $year, $component, $weight, ...array_values($vals), $weight, ...array_values($vals)];
    $stmt->execute($params);

    echo json_encode(['success' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

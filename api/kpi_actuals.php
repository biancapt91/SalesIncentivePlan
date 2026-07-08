<?php
// ================================================
//  e-SIP | KPI Actuals API
//  GET  ?employee_id=xxx&year=YYYY  — actual values per component for one associate/year
//  POST { employee_id, year, component, jan..dec } — upsert one row
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

$pdo = getDB();

// Table creation is handled by database.sql (or first-run bootstrap).
// Removed per-request CREATE TABLE / ALTER TABLE — these caused lock contention
// when the dashboard fired 12 parallel requests to this endpoint.

$method = $_SERVER['REQUEST_METHOD'];
// Map JS key → DB column name
$monthMap = ['jan'=>'jan','feb'=>'feb','mar'=>'mar','apr'=>'apr','may'=>'may',
             'jun'=>'jun','jul'=>'jul','aug'=>'aug','sep'=>'sep','oct'=>'oct',
             'nov'=>'nov','dec'=>'dec_val'];

// -----------------------------------------------
//  GET
// -----------------------------------------------
if ($method === 'GET') {
    $empId    = trim($_GET['employee_id'] ?? '');
    $year     = (int) ($_GET['year'] ?? date('Y'));
    $monthKey = trim($_GET['month_key'] ?? '');

    // ── Batch: all months at once (used by dashboard to avoid 12 parallel requests) ──
    if ($empId === '' && isset($_GET['all_months'])) {
        $stmt = $pdo->prepare(
            "SELECT a.employee_id, a.full_name, a.position, a.level, a.detail_area,
                    t.component,
                    CAST(t.weight AS DECIMAL(5,2)) AS weight,
                    COALESCE(t.jan,     0) AS target_jan,  COALESCE(ac.jan,     0) AS actual_jan,
                    COALESCE(t.feb,     0) AS target_feb,  COALESCE(ac.feb,     0) AS actual_feb,
                    COALESCE(t.mar,     0) AS target_mar,  COALESCE(ac.mar,     0) AS actual_mar,
                    COALESCE(t.apr,     0) AS target_apr,  COALESCE(ac.apr,     0) AS actual_apr,
                    COALESCE(t.may,     0) AS target_may,  COALESCE(ac.may,     0) AS actual_may,
                    COALESCE(t.jun,     0) AS target_jun,  COALESCE(ac.jun,     0) AS actual_jun,
                    COALESCE(t.jul,     0) AS target_jul,  COALESCE(ac.jul,     0) AS actual_jul,
                    COALESCE(t.aug,     0) AS target_aug,  COALESCE(ac.aug,     0) AS actual_aug,
                    COALESCE(t.sep,     0) AS target_sep,  COALESCE(ac.sep,     0) AS actual_sep,
                    COALESCE(t.oct,     0) AS target_oct,  COALESCE(ac.oct,     0) AS actual_oct,
                    COALESCE(t.nov,     0) AS target_nov,  COALESCE(ac.nov,     0) AS actual_nov,
                    COALESCE(t.dec_val, 0) AS target_dec,  COALESCE(ac.dec_val, 0) AS actual_dec
             FROM kpi_targets t
             INNER JOIN associates a
                ON a.employee_id = t.employee_id
             INNER JOIN kpi_actuals ac
                ON  ac.employee_id = t.employee_id
                AND ac.year        = t.year
                AND ac.component   = t.component
             WHERE t.year = ?
             ORDER BY a.full_name, t.component"
        );
        $stmt->execute([$year]);
        $rows = $stmt->fetchAll();

        $result = [];
        foreach ($monthMap as $mk => $dbCol) {
            $result[$mk] = [];
        }
        foreach ($rows as $r) {
            foreach ($monthMap as $mk => $dbCol) {
                $targetKey = 'target_' . $mk;
                $actualKey = 'actual_' . $mk;
                $result[$mk][] = [
                    'employee_id' => $r['employee_id'],
                    'full_name'   => $r['full_name'],
                    'position'    => $r['position'],
                    'level'       => $r['level'],
                    'detail_area' => $r['detail_area'],
                    'component'   => $r['component'],
                    'weight'      => (float) $r['weight'],
                    'target_val'  => (float) $r[$targetKey],
                    'actual_val'  => (float) $r[$actualKey],
                ];
            }
        }
        echo json_encode(['success' => true, 'data' => $result]);
        exit;
    }

    // ── Summary: all associates for one month ──
    if ($empId === '' && $monthKey !== '') {
        if (!array_key_exists($monthKey, $monthMap)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month_key tidak valid.']);
            exit;
        }
        $dbCol = $monthMap[$monthKey];   // whitelisted column name
        $stmt  = $pdo->prepare(
            "SELECT a.employee_id, a.full_name, a.position, a.level, a.detail_area,
                    t.component,
                    CAST(t.weight AS DECIMAL(5,2)) AS weight,
                    COALESCE(t.`$dbCol`, 0)        AS target_val,
                    COALESCE(ac.`$dbCol`, 0)       AS actual_val
             FROM kpi_targets t
             INNER JOIN associates a
                ON a.employee_id = t.employee_id
             INNER JOIN kpi_actuals ac
                ON  ac.employee_id = t.employee_id
                AND ac.year        = t.year
                AND ac.component   = t.component
             WHERE t.year = ?
             ORDER BY a.full_name, t.component"
        );
        $stmt->execute([$year]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['weight']     = (float) $r['weight'];
            $r['target_val'] = (float) $r['target_val'];
            $r['actual_val'] = (float) $r['actual_val'];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    // ── Per-associate: all month columns ──
    if ($empId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'employee_id atau month_key wajib diisi.']);
        exit;
    }

    $stmt = $pdo->prepare(
        "SELECT component, jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec_val
         FROM kpi_actuals WHERE employee_id = ? AND year = ?"
    );
    $stmt->execute([$empId, $year]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$r) {
        $r['dec'] = (float) ($r['dec_val'] ?? 0);
        unset($r['dec_val']);
        foreach (['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov'] as $m) {
            $r[$m] = (float) $r[$m];
        }
    }
    unset($r);

    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
}

// -----------------------------------------------
//  POST — upsert one component row
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

    // Ensure sip tables exist (idempotent)
    try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS `sip_locked_cells` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `employee_id` VARCHAR(20) NOT NULL, `year` SMALLINT NOT NULL,
        `component` VARCHAR(150) NOT NULL, `month_key` VARCHAR(5) NOT NULL,
        `locked_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY `uk_cell` (`employee_id`,`year`,`component`,`month_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS `sip_reports` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `period_month` TINYINT NOT NULL, `period_year` SMALLINT NOT NULL,
        `status` ENUM('draft','paid') NOT NULL DEFAULT 'draft',
        UNIQUE KEY `uk_period` (`period_month`,`period_year`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS `sip_carryforward` (
        `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `employee_id` VARCHAR(20) NOT NULL, `year` SMALLINT NOT NULL,
        `component` VARCHAR(150) NOT NULL,
        `source_month` TINYINT NOT NULL, `source_year` SMALLINT NOT NULL,
        `target_month` TINYINT NOT NULL, `target_year` SMALLINT NOT NULL,
        `actual_val` DECIMAL(12,4) NOT NULL DEFAULT 0,
        `sip_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
        `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY `uk_cf` (`employee_id`,`year`,`component`,`source_month`,`source_year`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } catch (PDOException $e) { /* tables may already exist */ }

    // Fetch current locked cells for this employee+year+component
    $lockedStmt = $pdo->prepare("
        SELECT month_key FROM sip_locked_cells
        WHERE employee_id=? AND year=? AND component=?
    ");
    $lockedStmt->execute([$empId, $year, $component]);
    $lockedMonths = array_column($lockedStmt->fetchAll(), 'month_key', 'month_key');

    // Fetch existing actual values (to detect 0→nonzero changes for paid months)
    $existStmt = $pdo->prepare("SELECT " . implode(',', array_values($monthMap)) . " FROM kpi_actuals WHERE employee_id=? AND year=? AND component=?");
    $existStmt->execute([$empId, $year, $component]);
    $existRow = $existStmt->fetch() ?: [];

    // Fetch paid month numbers for this year
    $paidStmt = $pdo->prepare("SELECT period_month FROM sip_reports WHERE period_year=? AND status='paid'");
    $paidStmt->execute([$year]);
    $paidMonths = array_column($paidStmt->fetchAll(), 'period_month', 'period_month');
    // month number → month_key
    $monthKeysByNum = array_keys($monthMap); // [0=>'jan', 1=>'feb', ...]

    $vals        = [];
    $carryForwards = [];
    $lockedRejected = [];

    foreach ($monthMap as $jsKey => $dbCol) {
        $newVal = (float) ($body[$jsKey] ?? 0);

        // Is this cell locked?
        if (isset($lockedMonths[$jsKey])) {
            // Preserve existing value — use whatever is in DB
            $vals[$dbCol] = (float) ($existRow[$dbCol] ?? 0);
            if ($newVal !== $vals[$dbCol]) {
                $lockedRejected[] = $jsKey;
            }
            continue;
        }

        $vals[$dbCol] = $newVal;

        // Detect late entry for a paid month (was 0, now has value)
        $monthNum = array_search($jsKey, $monthKeysByNum) + 1; // 1-based
        $existingVal = (float) ($existRow[$dbCol] ?? 0);
        if (isset($paidMonths[$monthNum]) && $existingVal == 0 && $newVal > 0) {
            // Use client-provided target month if valid, otherwise default to next month
            $clientTgt  = (int) ($body['late_entry_target_month'] ?? 0);
            $clientTgtY = (int) ($body['late_entry_target_year']  ?? 0);
            if ($clientTgt >= 1 && $clientTgt <= 12 && $clientTgtY >= 2000) {
                $tgtMonth = $clientTgt;
                $tgtYear  = $clientTgtY;
            } else {
                $tgtMonth = $monthNum + 1;
                $tgtYear  = $year;
                if ($tgtMonth > 12) { $tgtMonth = 1; $tgtYear++; }
            }
            $carryForwards[] = [
                'employee_id'  => $empId,
                'year'         => $year,
                'component'    => $component,
                'source_month' => $monthNum,
                'source_year'  => $year,
                'target_month' => $tgtMonth,
                'target_year'  => $tgtYear,
                'actual_val'   => $newVal,
                'sip_amount'   => 0, // calculated server-side would need full KPI logic; JS will update display
            ];
        }
    }

    $dbCols       = array_keys($vals);
    $setClauses   = implode(', ', array_map(fn($c) => "`$c` = ?", $dbCols));
    $colList      = implode(',', array_map(fn($c) => "`$c`", $dbCols));
    $placeholders = implode(',', array_fill(0, count($dbCols), '?'));

    $stmt = $pdo->prepare(
        "INSERT INTO kpi_actuals (employee_id, year, component, $colList)
         VALUES (?, ?, ?, $placeholders)
         ON DUPLICATE KEY UPDATE $setClauses"
    );
    $params = [$empId, $year, $component, ...array_values($vals), ...array_values($vals)];
    $stmt->execute($params);

    // Save carry-forwards
    if (!empty($carryForwards)) {
        $cfStmt = $pdo->prepare("
            INSERT IGNORE INTO sip_carryforward
              (employee_id, year, component, source_month, source_year, target_month, target_year, actual_val, sip_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        foreach ($carryForwards as $cf) {
            $cfStmt->execute([
                $cf['employee_id'], $cf['year'], $cf['component'],
                $cf['source_month'], $cf['source_year'],
                $cf['target_month'], $cf['target_year'],
                $cf['actual_val'], $cf['sip_amount'],
            ]);
            // NOTE: The source-month cell is NOT locked here.
            // It will be locked when the carry-forward's TARGET month is paid
            // (in sip_report.php action=pay), so the cell remains editable
            // until the SIP for the carry-forward month is actually disbursed.
        }
    }

    echo json_encode([
        'success'          => true,
        'locked_rejected'  => $lockedRejected,
        'carry_forwards'   => count($carryForwards),
    ]);
    exit;
}

// -----------------------------------------------
//  DELETE — remove one component row
// -----------------------------------------------
if ($method === 'DELETE') {
    $body      = json_decode(file_get_contents('php://input'), true);
    $empId     = trim($body['employee_id'] ?? '');
    $year      = (int) ($body['year'] ?? 0);
    $component = trim($body['component'] ?? '');

    if ($empId === '' || $year < 2000 || $component === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'employee_id, year, dan component wajib diisi.']);
        exit;
    }

    $stmt = $pdo->prepare(
        "DELETE FROM kpi_actuals WHERE employee_id = ? AND year = ? AND component = ?"
    );
    $stmt->execute([$empId, $year, $component]);
    echo json_encode(['success' => true, 'deleted' => $stmt->rowCount()]);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

<?php
// ================================================
//  e-SIP | SIP Report API
//  GET  ?action=list                            — list all report periods
//  GET  ?action=status&month=M&year=Y           — paid/draft status for a period
//  GET  ?action=locked_cells&employee_id=X&year=Y — locked cells for employee
//  GET  ?action=carryforward&month=M&year=Y     — carry-forwards targeting this month
//  POST {action:'pay',   month,year,total_sip}  — mark period as paid & lock cells
//  POST {action:'unpay', month,year}            — revert to draft (admin only)
// ================================================
ob_start();
ini_set('display_errors', 0);
error_reporting(0);
session_start();
ob_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Global exception handler — always return JSON
set_exception_handler(function(Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    exit;
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// Require any authenticated session
if (empty($_SESSION['esip_user'])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Forbidden.']);
    exit;
}

$sessionRole = $_SESSION['esip_role'] ?? '';
$isAdmin     = in_array($sessionRole, ['admin', 'head_admin', 'sales_admin'], true);

require_once __DIR__ . '/config.php';
$pdo = getDB();

// ── Ensure tables exist ──────────────────────────────────────────────────────
try {
$pdo->exec("
    CREATE TABLE IF NOT EXISTS `sip_reports` (
        `id`           INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `period_month` TINYINT        NOT NULL,
        `period_year`  SMALLINT       NOT NULL,
        `status`       ENUM('draft','paid') NOT NULL DEFAULT 'draft',
        `total_sip`    DECIMAL(18,2)  NOT NULL DEFAULT 0,
        `paid_at`      TIMESTAMP      NULL DEFAULT NULL,
        `paid_by`      VARCHAR(150)   NULL DEFAULT NULL,
        `created_at`   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY `uk_period` (`period_month`, `period_year`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

$pdo->exec("
    CREATE TABLE IF NOT EXISTS `sip_locked_cells` (
        `id`          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `employee_id` VARCHAR(20)  NOT NULL,
        `year`        SMALLINT     NOT NULL,
        `component`   VARCHAR(150) NOT NULL,
        `month_key`   VARCHAR(5)   NOT NULL,
        `locked_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY `uk_cell` (`employee_id`, `year`, `component`, `month_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");

$pdo->exec("
    CREATE TABLE IF NOT EXISTS `sip_carryforward` (
        `id`           INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `employee_id`  VARCHAR(20)   NOT NULL,
        `year`         SMALLINT      NOT NULL,
        `component`    VARCHAR(150)  NOT NULL,
        `source_month` TINYINT       NOT NULL,
        `source_year`  SMALLINT      NOT NULL,
        `target_month` TINYINT       NOT NULL,
        `target_year`  SMALLINT      NOT NULL,
        `actual_val`   DECIMAL(12,4) NOT NULL DEFAULT 0,
        `sip_amount`   DECIMAL(18,2) NOT NULL DEFAULT 0,
        `created_at`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY `uk_cf` (`employee_id`, `year`, `component`, `source_month`, `source_year`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
");
} catch (PDOException $e) {
    // Tables may already exist or slight schema diff — continue
}
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? $_POST['action'] ?? '';

// month→DB column map
$monthMap = [
    'jan'=>'jan','feb'=>'feb','mar'=>'mar','apr'=>'apr','may'=>'may','jun'=>'jun',
    'jul'=>'jul','aug'=>'aug','sep'=>'sep','oct'=>'oct','nov'=>'nov','dec'=>'dec_val'
];

// ── GET ──────────────────────────────────────────────────────────────────────
if ($method === 'GET') {

    // List all report periods — admin only
    if ($action === 'list') {
        if (!$isAdmin) { http_response_code(403); echo json_encode(['success'=>false,'message'=>'Forbidden.']); exit; }
        $rows = $pdo->query("
            SELECT period_month, period_year, status, total_sip, paid_at, paid_by
            FROM sip_reports ORDER BY period_year DESC, period_month DESC
        ")->fetchAll();
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    // Status for a specific period
    if ($action === 'status') {
        $month = (int) ($_GET['month'] ?? 0);
        $year  = (int) ($_GET['year']  ?? 0);
        if ($month < 1 || $month > 12 || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month/year tidak valid.']);
            exit;
        }
        $stmt = $pdo->prepare("SELECT * FROM sip_reports WHERE period_month=? AND period_year=?");
        $stmt->execute([$month, $year]);
        $row = $stmt->fetch();
        echo json_encode(['success' => true, 'data' => $row ?: null]);
        exit;
    }

    // Locked cells for an employee/year
    if ($action === 'locked_cells') {
        $empId = trim($_GET['employee_id'] ?? '');
        $year  = (int) ($_GET['year'] ?? 0);
        if ($empId === '' || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'employee_id / year wajib diisi.']);
            exit;
        }
        $stmt = $pdo->prepare("
            SELECT component, month_key FROM sip_locked_cells
            WHERE employee_id=? AND year=?
        ");
        $stmt->execute([$empId, $year]);
        $rows = $stmt->fetchAll();
        // Return as set: { "component::month_key": true }
        $set = [];
        foreach ($rows as $r) {
            $set[$r['component'] . '::' . $r['month_key']] = true;
        }
        echo json_encode(['success' => true, 'data' => $set]);
        exit;
    }

    // Carry-forwards targeting a specific month (to show in that month's report)
    if ($action === 'carryforward') {
        $month = (int) ($_GET['month'] ?? 0);
        $year  = (int) ($_GET['year']  ?? 0);
        if ($month < 1 || $month > 12 || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month/year tidak valid.']);
            exit;
        }
        $stmt = $pdo->prepare("
            SELECT cf.employee_id, cf.component, cf.source_month, cf.source_year,
                   cf.actual_val, cf.sip_amount, a.full_name
            FROM sip_carryforward cf
            LEFT JOIN associates a ON a.employee_id = cf.employee_id COLLATE utf8mb4_unicode_ci
            WHERE cf.target_month=? AND cf.target_year=?
            ORDER BY a.full_name, cf.component
        ");
        $stmt->execute([$month, $year]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['actual_val']   = (float) $r['actual_val'];
            $r['sip_amount']   = (float) $r['sip_amount'];
            $r['source_month'] = (int)   $r['source_month'];
            $r['source_year']  = (int)   $r['source_year'];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    // Late entries for a specific month: carry-forwards whose source is this month
    // Used to exclude late-submitted actuals from the paid month's SIP Earned
    if ($action === 'late_entries') {
        $month = (int) ($_GET['month'] ?? 0);
        $year  = (int) ($_GET['year']  ?? 0);
        if ($month < 1 || $month > 12 || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month/year tidak valid.']);
            exit;
        }
        $stmt = $pdo->prepare("
            SELECT cf.employee_id, cf.component, cf.actual_val,
                   cf.target_month, cf.target_year,
                   a.full_name
            FROM sip_carryforward cf
            LEFT JOIN associates a ON a.employee_id = cf.employee_id COLLATE utf8mb4_unicode_ci
            WHERE cf.source_month=? AND cf.source_year=?
            ORDER BY a.full_name, cf.component
        ");
        $stmt->execute([$month, $year]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['actual_val']   = (float) $r['actual_val'];
            $r['target_month'] = (int)   $r['target_month'];
            $r['target_year']  = (int)   $r['target_year'];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'action tidak dikenali.']);
    exit;
}

// ── POST ─────────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $body['action'] ?? '';

    // ── Mark as Paid — admin only ──────────────────────────────────────────
    if ($action === 'pay') {
        if (!$isAdmin) { http_response_code(403); echo json_encode(['success'=>false,'message'=>'Forbidden.']); exit; }
        $month    = (int) ($body['month']     ?? 0);
        $year     = (int) ($body['year']      ?? 0);
        $totalSip = (float) ($body['total_sip'] ?? 0);
        $paidBy   = trim($body['paid_by'] ?? 'admin');

        if ($month < 1 || $month > 12 || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month/year tidak valid.']);
            exit;
        }

        // Check not already paid
        $stmt = $pdo->prepare("SELECT status FROM sip_reports WHERE period_month=? AND period_year=?");
        $stmt->execute([$month, $year]);
        $existing = $stmt->fetchColumn();
        if ($existing === 'paid') {
            echo json_encode(['success' => false, 'message' => 'Period ini sudah berstatus Paid.']);
            exit;
        }

        $dbCol = $monthMap[array_keys($monthMap)[$month - 1]];

        // Get all non-zero actuals for this month
        $stmt = $pdo->prepare("
            SELECT employee_id, year, component, `$dbCol` AS val
            FROM kpi_actuals
            WHERE year=? AND `$dbCol` > 0
        ");
        $stmt->execute([$year]);
        $tolock = $stmt->fetchAll();

        $monthKey = array_keys($monthMap)[$month - 1]; // 0-indexed → jan,feb,...

        $pdo->beginTransaction();
        try {
            // Upsert sip_reports
            $pdo->prepare("
                INSERT INTO sip_reports (period_month, period_year, status, total_sip, paid_at, paid_by)
                VALUES (?, ?, 'paid', ?, NOW(), ?)
                ON DUPLICATE KEY UPDATE status='paid', total_sip=?, paid_at=NOW(), paid_by=?
            ")->execute([$month, $year, $totalSip, $paidBy, $totalSip, $paidBy]);

            // Lock all non-zero cells
            if (!empty($tolock)) {
                $lockStmt = $pdo->prepare("
                    INSERT IGNORE INTO sip_locked_cells (employee_id, year, component, month_key)
                    VALUES (?, ?, ?, ?)
                ");
                foreach ($tolock as $r) {
                    $lockStmt->execute([$r['employee_id'], $r['year'], $r['component'], $monthKey]);
                }
            }

            // Lock source-month cells for carry-forwards whose TARGET is this month.
            // These are late entries from a previous month that should be locked
            // only once the carry-forward month itself is paid.
            $cfSourceStmt = $pdo->prepare("
                SELECT employee_id, source_year, component, source_month
                FROM sip_carryforward
                WHERE target_month=? AND target_year=?
            ");
            $cfSourceStmt->execute([$month, $year]);
            $cfSourceRows = $cfSourceStmt->fetchAll();
            if (!empty($cfSourceRows)) {
                $cfLockStmt = $pdo->prepare("
                    INSERT IGNORE INTO sip_locked_cells (employee_id, year, component, month_key)
                    VALUES (?, ?, ?, ?)
                ");
                $monthKeysList = ['jan','feb','mar','apr','may','jun','jul','aug','sep',
                                  'oct','nov','dec'];
                foreach ($cfSourceRows as $lk) {
                    $srcMonthKey = $monthKeysList[$lk['source_month'] - 1];
                    $cfLockStmt->execute([$lk['employee_id'], $lk['source_year'],
                                         $lk['component'], $srcMonthKey]);
                }
            }

            $pdo->commit();
            echo json_encode(['success' => true, 'locked_count' => count($tolock)]);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;
    }

    // ── Revert to Draft — admin only ───────────────────────────────────────
    if ($action === 'unpay') {
        if (!$isAdmin) { http_response_code(403); echo json_encode(['success'=>false,'message'=>'Forbidden.']); exit; }
        $month = (int) ($body['month'] ?? 0);
        $year  = (int) ($body['year']  ?? 0);
        if ($month < 1 || $month > 12 || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month/year tidak valid.']);
            exit;
        }
        $monthKey = array_keys($monthMap)[$month - 1];

        $pdo->beginTransaction();
        try {
            $pdo->prepare("UPDATE sip_reports SET status='draft', paid_at=NULL, paid_by=NULL WHERE period_month=? AND period_year=?")->execute([$month, $year]);
            // Remove locked cells for this month
            $pdo->prepare("DELETE FROM sip_locked_cells WHERE month_key=? AND year=?")->execute([$monthKey, $year]);
            // Remove carry-forwards originating from this month
            $pdo->prepare("DELETE FROM sip_carryforward WHERE source_month=? AND source_year=?")->execute([$month, $year]);
            $pdo->commit();
            echo json_encode(['success' => true]);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'action tidak dikenali.']);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

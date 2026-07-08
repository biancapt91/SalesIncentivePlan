<?php
// ================================================
//  e-SIP | KPI Unlock Request API
//  GET  ?action=list[&status=pending]          — list requests (admin)
//  GET  ?action=count                          — count pending (admin)
//  GET  ?action=adjustments&month=M&year=Y     — adjustments targeting a month
//  POST {action:'request', ...}                — submit request (non-SA)
//  POST {action:'approve', id, sip_delta}      — approve (admin only)
//  POST {action:'reject',  id, review_notes}   — reject  (admin only)
// ================================================
ob_start();
ini_set('display_errors', 0);
error_reporting(0);

session_start();

ob_clean();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

set_exception_handler(function (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    exit;
});

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

if (empty($_SESSION['esip_user'])) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Not authenticated.']);
    exit;
}

$loggedUser = $_SESSION['esip_user'];
$loggedRole = $_SESSION['esip_role'] ?? 'sales_associate';
$isAdmin    = ($loggedRole === 'admin');

require_once __DIR__ . '/config.php';
$pdo = getDB();

// ── Ensure tables exist (utf8mb4_0900_ai_ci matches MySQL 8 default / associates table) ─────
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `sip_unlock_requests` (
            `id`               INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `employee_id`      VARCHAR(20)   NOT NULL,
            `year`             SMALLINT      NOT NULL,
            `component`        VARCHAR(150)  NOT NULL,
            `month_key`        VARCHAR(5)    NOT NULL,
            `old_value`        DECIMAL(12,4) NOT NULL DEFAULT 0,
            `new_value`        DECIMAL(12,4) NOT NULL DEFAULT 0,
            `reason`           TEXT          NOT NULL,
            `status`           ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
            `requested_by`     VARCHAR(150)  NOT NULL,
            `requested_at`     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `reviewed_by`      VARCHAR(150)  NULL DEFAULT NULL,
            `reviewed_at`      TIMESTAMP     NULL DEFAULT NULL,
            `review_notes`     VARCHAR(500)  NULL DEFAULT NULL,
            `cf_target_month`  TINYINT       NULL DEFAULT NULL,
            `cf_target_year`   SMALLINT      NULL DEFAULT NULL,
            KEY `idx_status`   (`status`),
            KEY `idx_employee` (`employee_id`, `year`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `sip_adjustments` (
            `id`                 INT           NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `employee_id`        VARCHAR(20)   NOT NULL,
            `component`          VARCHAR(150)  NOT NULL,
            `source_month`       TINYINT       NOT NULL,
            `source_year`        SMALLINT      NOT NULL,
            `target_month`       TINYINT       NOT NULL,
            `target_year`        SMALLINT      NOT NULL,
            `old_value`          DECIMAL(12,4) NOT NULL DEFAULT 0,
            `new_value`          DECIMAL(12,4) NOT NULL DEFAULT 0,
            `sip_delta`          DECIMAL(18,2) NOT NULL DEFAULT 0,
            `unlock_request_id`  INT           NOT NULL,
            `created_at`         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY `uk_adj`    (`employee_id`, `source_month`, `source_year`, `component`),
            KEY        `idx_target` (`target_month`, `target_year`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    ");
    // Fix collation on tables that may have been created with a different collation
    $pdo->exec("ALTER TABLE sip_unlock_requests CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
    $pdo->exec("ALTER TABLE sip_adjustments     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
} catch (PDOException $e) {
    /* ignore if tables already exist */
}

// Migration: add cf_target_month/year to sip_unlock_requests if not yet present
try { $pdo->exec("ALTER TABLE sip_unlock_requests ADD COLUMN cf_target_month TINYINT NULL DEFAULT NULL"); } catch (PDOException $e) { /* already exists */ }
try { $pdo->exec("ALTER TABLE sip_unlock_requests ADD COLUMN cf_target_year SMALLINT NULL DEFAULT NULL"); } catch (PDOException $e) { /* already exists */ }

// Fix collation mismatch with associates table (utf8mb4_0900_ai_ci vs utf8mb4_unicode_ci)
try { $pdo->exec("ALTER TABLE sip_unlock_requests CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"); } catch (PDOException $e) { /* already correct */ }
try { $pdo->exec("ALTER TABLE sip_adjustments     CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"); } catch (PDOException $e) { /* already correct */ }

$method = $_SERVER['REQUEST_METHOD'];

// ── GET ───────────────────────────────────────────────────────────────────
if ($method === 'GET') {
    $action = $_GET['action'] ?? '';

    // List unlock requests — admin only
    if ($action === 'list') {
        if (!$isAdmin) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Akses ditolak.']);
            exit;
        }
        $status = $_GET['status'] ?? '';
        $where  = $status ? 'WHERE r.status = ?' : '';
        $params = $status ? [$status] : [];
        $stmt   = $pdo->prepare("
            SELECT r.*, a.full_name AS employee_name
            FROM sip_unlock_requests r
            LEFT JOIN associates a ON a.employee_id = r.employee_id COLLATE utf8mb4_0900_ai_ci
            $where
            ORDER BY r.requested_at DESC
            LIMIT 200
        ");
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id']        = (int)   $r['id'];
            $r['year']      = (int)   $r['year'];
            $r['old_value'] = (float) $r['old_value'];
            $r['new_value'] = (float) $r['new_value'];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    // Count pending requests — admin gets real count, others get 0
    if ($action === 'count') {
        if (!$isAdmin) {
            echo json_encode(['success' => true, 'count' => 0]);
            exit;
        }
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM sip_unlock_requests WHERE status = 'pending'");
        $stmt->execute();
        echo json_encode(['success' => true, 'count' => (int) $stmt->fetchColumn()]);
        exit;
    }

    // Adjustments targeting a specific month (for SIP Report carry-forward display)
    if ($action === 'adjustments') {
        $month = (int) ($_GET['month'] ?? 0);
        $year  = (int) ($_GET['year']  ?? 0);
        if ($month < 1 || $month > 12 || $year < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'month/year tidak valid.']);
            exit;
        }
        $stmt = $pdo->prepare("
            SELECT adj.*, a.full_name AS employee_name
            FROM sip_adjustments adj
            LEFT JOIN associates a ON a.employee_id = adj.employee_id COLLATE utf8mb4_0900_ai_ci
            WHERE adj.target_month = ? AND adj.target_year = ?
            ORDER BY a.full_name, adj.component
        ");
        $stmt->execute([$month, $year]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            $r['id']           = (int)   $r['id'];
            $r['source_month'] = (int)   $r['source_month'];
            $r['source_year']  = (int)   $r['source_year'];
            $r['old_value']    = (float) $r['old_value'];
            $r['new_value']    = (float) $r['new_value'];
            $r['sip_delta']    = (float) $r['sip_delta'];
        }
        unset($r);
        echo json_encode(['success' => true, 'data' => $rows]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'action tidak dikenali.']);
    exit;
}

// ── POST ──────────────────────────────────────────────────────────────────
if ($method === 'POST') {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = $body['action'] ?? '';

    // Submit a new request — any authenticated non-SA user
    if ($action === 'request') {
        if ($loggedRole === 'sales_associate') {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Akses ditolak.']);
            exit;
        }

        $empId     = trim($body['employee_id'] ?? '');
        $year      = (int) ($body['year'] ?? 0);
        $component = trim($body['component'] ?? '');
        $monthKey  = trim($body['month_key'] ?? '');
        $oldVal    = (float) ($body['old_value'] ?? 0);
        $newVal    = (float) ($body['new_value'] ?? 0);
        $reason    = trim($body['reason'] ?? '');

        $cfTargetMonth = (int) ($body['cf_target_month'] ?? 0);
        $cfTargetYear  = (int) ($body['cf_target_year']  ?? 0);

        if ($empId === '' || $year < 2000 || $component === '' || $monthKey === '' || $reason === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Semua field wajib diisi.']);
            exit;
        }
        if ($newVal < 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Nilai baru tidak boleh negatif.']);
            exit;
        }
        if ($cfTargetMonth < 1 || $cfTargetMonth > 12 || $cfTargetYear < 2000) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Bulan carry-forward tidak valid.']);
            exit;
        }

        // Reject duplicate pending request for the same cell
        $chk = $pdo->prepare("
            SELECT id FROM sip_unlock_requests
            WHERE employee_id = ? AND year = ? AND component = ? AND month_key = ? AND status = 'pending'
        ");
        $chk->execute([$empId, $year, $component, $monthKey]);
        if ($chk->fetchColumn()) {
            echo json_encode(['success' => false, 'message' => 'Sudah ada permintaan pending untuk sel ini. Tunggu hasil review admin.']);
            exit;
        }

        $pdo->prepare("
            INSERT INTO sip_unlock_requests
                (employee_id, year, component, month_key, old_value, new_value, reason, requested_by, cf_target_month, cf_target_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([$empId, $year, $component, $monthKey, $oldVal, $newVal, $reason, $loggedUser, $cfTargetMonth, $cfTargetYear]);

        echo json_encode(['success' => true, 'message' => 'Permintaan perubahan telah dikirim ke admin untuk persetujuan.']);
        exit;
    }

    // Approve / Reject — admin only
    if (!$isAdmin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Hanya admin yang dapat menyetujui/menolak permintaan.']);
        exit;
    }

    // Approve request
    if ($action === 'approve') {
        $id       = (int)   ($body['id']        ?? 0);
        $sipDelta = (float) ($body['sip_delta']  ?? 0);

        if ($id <= 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'id tidak valid.']);
            exit;
        }

        $stmt = $pdo->prepare("SELECT * FROM sip_unlock_requests WHERE id = ? AND status = 'pending'");
        $stmt->execute([$id]);
        $req = $stmt->fetch();
        if (!$req) {
            echo json_encode(['success' => false, 'message' => 'Permintaan tidak ditemukan atau sudah diproses.']);
            exit;
        }

        $empId     = $req['employee_id'];
        $year      = (int)   $req['year'];
        $component = $req['component'];
        $monthKey  = $req['month_key'];
        $newVal    = (float) $req['new_value'];
        $oldVal    = (float) $req['old_value'];

        // Mapping from month_key to 1-based month number and DB column name
        $monthMap    = ['jan'=>1,'feb'=>2,'mar'=>3,'apr'=>4,'may'=>5,'jun'=>6,
                        'jul'=>7,'aug'=>8,'sep'=>9,'oct'=>10,'nov'=>11,'dec'=>12];
        $monthDbCols = ['jan'=>'jan','feb'=>'feb','mar'=>'mar','apr'=>'apr','may'=>'may','jun'=>'jun',
                        'jul'=>'jul','aug'=>'aug','sep'=>'sep','oct'=>'oct','nov'=>'nov','dec'=>'dec_val'];

        $srcMonth = $monthMap[$monthKey] ?? 0;
        if ($srcMonth === 0) {
            echo json_encode(['success' => false, 'message' => "month_key '{$monthKey}' tidak valid."]);
            exit;
        }

        $dbCol    = $monthDbCols[$monthKey];
        // Use the carry-forward month chosen by the requester; fall back to next month
        $tgtMonth = ($req['cf_target_month'] && (int)$req['cf_target_month'] > 0)
            ? (int) $req['cf_target_month']
            : $srcMonth + 1;
        $tgtYear  = ($req['cf_target_year']  && (int)$req['cf_target_year']  > 0)
            ? (int) $req['cf_target_year']
            : $year;
        if ($tgtMonth > 12) { $tgtMonth = 1; $tgtYear++; }

        $pdo->beginTransaction();
        try {
            // 1. Update the KPI actual value
            $upd = $pdo->prepare("UPDATE kpi_actuals SET `{$dbCol}` = ? WHERE employee_id = ? AND year = ? AND component = ?");
            $upd->execute([$newVal, $empId, $year, $component]);

            // 2. Mark request as approved
            $pdo->prepare("
                UPDATE sip_unlock_requests
                SET status = 'approved', reviewed_by = ?, reviewed_at = NOW()
                WHERE id = ?
            ")->execute([$loggedUser, $id]);

            // 3. Record SIP adjustment carry-forward for next month (only if meaningful delta)
            if (abs($sipDelta) >= 1) {
                // Remove any prior adjustment entry for this cell (idempotent re-approval)
                $pdo->prepare("
                    DELETE FROM sip_adjustments
                    WHERE employee_id = ? AND source_month = ? AND source_year = ? AND component = ?
                ")->execute([$empId, $srcMonth, $year, $component]);

                $pdo->prepare("
                    INSERT INTO sip_adjustments
                        (employee_id, component, source_month, source_year,
                         target_month, target_year, old_value, new_value, sip_delta, unlock_request_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ")->execute([$empId, $component, $srcMonth, $year,
                              $tgtMonth, $tgtYear, $oldVal, $newVal, $sipDelta, $id]);
            }

            $pdo->commit();
            echo json_encode(['success' => true, 'message' => 'Permintaan disetujui. Nilai KPI telah diperbarui.']);
        } catch (Exception $e) {
            $pdo->rollBack();
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }
        exit;
    }

    // Reject request
    if ($action === 'reject') {
        $id    = (int) ($body['id'] ?? 0);
        $notes = trim($body['review_notes'] ?? '');

        if ($id <= 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'id tidak valid.']);
            exit;
        }

        $stmt = $pdo->prepare("SELECT id FROM sip_unlock_requests WHERE id = ? AND status = 'pending'");
        $stmt->execute([$id]);
        if (!$stmt->fetchColumn()) {
            echo json_encode(['success' => false, 'message' => 'Permintaan tidak ditemukan atau sudah diproses.']);
            exit;
        }

        $pdo->prepare("
            UPDATE sip_unlock_requests
            SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
            WHERE id = ?
        ")->execute([$loggedUser, $notes, $id]);

        echo json_encode(['success' => true, 'message' => 'Permintaan telah ditolak.']);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'action tidak dikenali.']);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

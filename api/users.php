<?php
// ================================================
//  e-SIP | User Account Management API
//  Only accessible by admin session
// ================================================
ob_start();
ini_set('display_errors', 0);
error_reporting(0);
session_start();
ob_clean();
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Guard: only admin can manage users
if (empty($_SESSION['esip_user']) || $_SESSION['esip_user'] !== 'admin') {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Forbidden.']);
    exit;
}

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// Ensure users table exists
function ensureTable(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `esip_users` (
            `id`           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
            `username`     VARCHAR(80)  NOT NULL UNIQUE,
            `password_hash` VARCHAR(255) NOT NULL,
            `full_name`    VARCHAR(150) NOT NULL,
            `role`         ENUM('admin','supervisor','sales_associate','head_admin','sales_admin') NOT NULL DEFAULT 'supervisor',
            `associate_id` VARCHAR(20)  NULL DEFAULT NULL,
            `detail_area`  VARCHAR(500) NULL DEFAULT NULL,
            `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    // Migrate: extend ENUM and add detail_area column for existing tables
    try { $pdo->exec("ALTER TABLE `esip_users` MODIFY COLUMN `role` ENUM('admin','supervisor','sales_associate','head_admin','sales_admin') NOT NULL DEFAULT 'supervisor'"); } catch (PDOException $e) {}
    try { $pdo->exec("ALTER TABLE `esip_users` MODIFY COLUMN `detail_area` VARCHAR(500) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    // ADD COLUMN IF NOT EXISTS not supported on MySQL < 8.0; check first
    $cols = $pdo->query("SHOW COLUMNS FROM `esip_users` LIKE 'detail_area'")->fetchAll();
    if (empty($cols)) {
        try { $pdo->exec("ALTER TABLE `esip_users` ADD COLUMN `detail_area` VARCHAR(500) NULL DEFAULT NULL"); } catch (PDOException $e) {}
    }
}

$pdo = getDB();
ensureTable($pdo);

// ── GET list ──────────────────────────────────
if ($method === 'GET' && $action === '') {
    $rows = $pdo->query("
        SELECT u.id, u.username, u.full_name, u.role, u.associate_id, u.detail_area,
               a.full_name AS associate_name
        FROM esip_users u
        LEFT JOIN associates a ON a.employee_id = u.associate_id
        ORDER BY u.id ASC
    ")->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(['success' => true, 'data' => $rows]);
    exit;
}

// ── POST create ──────────────────────────────
if ($method === 'POST') {
    $body         = json_decode(file_get_contents('php://input'), true) ?? [];
    $username     = trim($body['username'] ?? '');
    $password     = $body['password'] ?? '';
    $full_name    = trim($body['full_name'] ?? '');
    $role         = $body['role'] ?? '';
    $associate_id = !empty($body['associate_id']) ? trim($body['associate_id']) : null;
    $detail_area  = !empty($body['detail_area'])  ? trim($body['detail_area'])  : null;

    $allowed_roles = ['supervisor', 'sales_associate', 'head_admin', 'sales_admin'];

    if ($username === '' || $password === '' || $full_name === '' || !in_array($role, $allowed_roles, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap atau role tidak valid.']);
        exit;
    }
    if (mb_strlen($password) < 6) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Password minimal 6 karakter.']);
        exit;
    }
    // sales_associate must have associate_id
    if ($role === 'sales_associate' && $associate_id === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Role Sales Associate harus terhubung ke associate.']);
        exit;
    }
    // head_admin / sales_admin must have detail_area
    if (in_array($role, ['head_admin', 'sales_admin'], true) && $detail_area === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Role ini harus memiliki Detail Area.']);
        exit;
    }

    // username must not be 'admin' (reserved)
    if (strtolower($username) === 'admin') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Username "admin" sudah digunakan.']);
        exit;
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    try {
        $stmt = $pdo->prepare("
            INSERT INTO esip_users (username, password_hash, full_name, role, associate_id, detail_area)
            VALUES (?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([$username, $hash, $full_name, $role, $associate_id, $detail_area]);
        writeAuditLog('CREATE', 'users', $username, 'Tambah user: ' . $full_name . ' (role: ' . $role . ')');
        echo json_encode(['success' => true, 'id' => (int)$pdo->lastInsertId()]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'Username sudah digunakan.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Database error.']);
        }
    }
    exit;
}

// ── PUT update ────────────────────────────────
if ($method === 'PUT') {
    $id           = (int)($action);
    $body         = json_decode(file_get_contents('php://input'), true) ?? [];
    $username     = trim($body['username'] ?? '');
    $password     = $body['password'] ?? '';
    $full_name    = trim($body['full_name'] ?? '');
    $role         = $body['role'] ?? '';
    $associate_id = !empty($body['associate_id']) ? trim($body['associate_id']) : null;
    $detail_area  = !empty($body['detail_area'])  ? trim($body['detail_area'])  : null;

    $allowed_roles = ['supervisor', 'sales_associate', 'head_admin', 'sales_admin'];

    if ($id <= 0 || $username === '' || $full_name === '' || !in_array($role, $allowed_roles, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Data tidak lengkap.']);
        exit;
    }
    if ($role === 'sales_associate' && $associate_id === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Role Sales Associate harus terhubung ke associate.']);
        exit;
    }
    if (in_array($role, ['head_admin', 'sales_admin'], true) && $detail_area === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Role ini harus memiliki Detail Area.']);
        exit;
    }
    if (strtolower($username) === 'admin') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Username "admin" sudah digunakan.']);
        exit;
    }

    try {
        if ($password !== '') {
            if (mb_strlen($password) < 6) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Password minimal 6 karakter.']);
                exit;
            }
            $hash = password_hash($password, PASSWORD_BCRYPT);
            $stmt = $pdo->prepare("
                UPDATE esip_users
                SET username=?, password_hash=?, full_name=?, role=?, associate_id=?, detail_area=?
                WHERE id=?
            ");
            $stmt->execute([$username, $hash, $full_name, $role, $associate_id, $detail_area, $id]);
        } else {
            $stmt = $pdo->prepare("
                UPDATE esip_users
                SET username=?, full_name=?, role=?, associate_id=?, detail_area=?
                WHERE id=?
            ");
            $stmt->execute([$username, $full_name, $role, $associate_id, $detail_area, $id]);
        }
        writeAuditLog('UPDATE', 'users', $username, 'Update user: ' . $full_name . ' (role: ' . $role . ')');
        echo json_encode(['success' => true]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            http_response_code(409);
            echo json_encode(['success' => false, 'message' => 'Username sudah digunakan.']);
        } else {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Database error.']);
        }
    }
    exit;
}

// ── DELETE ────────────────────────────────────
if ($method === 'DELETE') {
    $id = (int)($action);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'ID tidak valid.']);
        exit;
    }
    $stmt = $pdo->prepare("DELETE FROM esip_users WHERE id=?");
    $stmt->execute([$id]);
    writeAuditLog('DELETE', 'users', (string)$id, 'Hapus user ID: ' . $id);
    echo json_encode(['success' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);

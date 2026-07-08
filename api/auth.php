<?php
// ================================================
//  e-SIP | Authentication API
// ================================================
session_start();
header('Content-Type: application/json');
header('Cache-Control: no-store, no-cache, must-revalidate');

// Hardcoded admin credentials (password hash = bcrypt of '123456')
define('ADMIN_USER',      'admin');
define('ADMIN_PASS_HASH', '$2y$10$YBjswXWlz5AqYusRXopMcuYHRw4qiCgQeLnUOdYKFp8fcdUQiAUfe');

require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── Check session ──────────────────────────────
if ($method === 'GET' && $action === 'check') {
    if (!empty($_SESSION['esip_user'])) {
        echo json_encode([
            'loggedIn'     => true,
            'username'     => $_SESSION['esip_user'],
            'role'         => $_SESSION['esip_role']         ?? 'admin',
            'fullName'     => $_SESSION['esip_full_name']    ?? 'Admin',
            'associateId'  => $_SESSION['esip_associate_id'] ?? null,
            'detailArea'   => $_SESSION['esip_detail_area']  ?? null,
        ]);
    } else {
        echo json_encode(['loggedIn' => false]);
    }
    exit;
}

// ── Logout ────────────────────────────────────
if ($method === 'GET' && $action === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

// ── Login ─────────────────────────────────────
if ($method === 'POST') {
    $body     = json_decode(file_get_contents('php://input'), true);
    $username = trim($body['username'] ?? '');
    $password = $body['password'] ?? '';

    if ($username === '' || $password === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Username and password are required.']);
        exit;
    }

    // Check hardcoded admin first
    if ($username === ADMIN_USER && password_verify($password, ADMIN_PASS_HASH)) {
        session_regenerate_id(true);
        $_SESSION['esip_user']         = $username;
        $_SESSION['esip_role']         = 'admin';
        $_SESSION['esip_full_name']    = 'Admin';
        $_SESSION['esip_associate_id'] = null;
        echo json_encode([
            'success'  => true,
            'role'     => 'admin',
            'fullName' => 'Admin',
        ]);
        exit;
    }

    // Check database users
    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare("
            SELECT id, username, password_hash, full_name, role, associate_id, detail_area
            FROM esip_users
            WHERE username = ?
            LIMIT 1
        ");
        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($user && password_verify($password, $user['password_hash'])) {
            session_regenerate_id(true);
            $_SESSION['esip_user']         = $user['username'];
            $_SESSION['esip_role']         = $user['role'];
            $_SESSION['esip_full_name']    = $user['full_name'];
            $_SESSION['esip_associate_id'] = $user['associate_id'];
            $_SESSION['esip_detail_area']  = $user['detail_area'] ?? null;
            echo json_encode([
                'success'      => true,
                'role'         => $user['role'],
                'fullName'     => $user['full_name'],
                'associateId'  => $user['associate_id'],
                'detailArea'   => $user['detail_area'] ?? null,
            ]);
        } else {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Wrong username or password.']);
        }
    } catch (Exception $e) {
        // Table may not exist yet — fallback
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Wrong username or password.']);
    }
    exit;
}

// ── Change Password ────────────────────────────
if ($method === 'PUT' && $action === 'change-password') {
    // Check if user is logged in
    if (empty($_SESSION['esip_user'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized. Please login first.']);
        exit;
    }

    $body              = json_decode(file_get_contents('php://input'), true) ?? [];
    $currentPassword   = $body['currentPassword'] ?? '';
    $newPassword       = $body['newPassword'] ?? '';
    $confirmPassword   = $body['confirmPassword'] ?? '';
    $username          = $_SESSION['esip_user'];

    // Validation
    if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Semua field wajib diisi.']);
        exit;
    }

    if ($newPassword !== $confirmPassword) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Password baru dan konfirmasi tidak cocok.']);
        exit;
    }

    if (mb_strlen($newPassword) < 6) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Password minimal 6 karakter.']);
        exit;
    }

    // Check if admin account
    if ($username === ADMIN_USER) {
        if (!password_verify($currentPassword, ADMIN_PASS_HASH)) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Password lama tidak sesuai.']);
            exit;
        }
        // Note: Admin account is hardcoded, so we can't change it in this flow
        // This is by design for security
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Admin account password cannot be changed via this interface.']);
        exit;
    }

    // For regular users, check against database
    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare("
            SELECT id, password_hash
            FROM esip_users
            WHERE username = ?
            LIMIT 1
        ");
        $stmt->execute([$username]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'User not found.']);
            exit;
        }

        // Verify current password
        if (!password_verify($currentPassword, $user['password_hash'])) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Password lama tidak sesuai.']);
            exit;
        }

        // Hash new password and update
        $newHash = password_hash($newPassword, PASSWORD_BCRYPT);
        $updateStmt = $pdo->prepare("
            UPDATE esip_users
            SET password_hash = ?
            WHERE id = ?
        ");
        $updateStmt->execute([$newHash, $user['id']]);

        echo json_encode(['success' => true, 'message' => 'Password berhasil diubah.']);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Database error.']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);


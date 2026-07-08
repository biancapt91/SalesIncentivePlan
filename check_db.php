<?php
require_once 'api/config.php';

$pdo = getDB();

echo "=== CHECKING ASSOCIATES TABLE ===\n";
$stmt = $pdo->query("DESCRIBE associates");
$columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Columns in associates:\n";
foreach ($columns as $col) {
    echo "  - {$col['Field']} ({$col['Type']})\n";
}

echo "\n=== SAMPLE DATA FROM ASSOCIATES ===\n";
$stmt = $pdo->query("SELECT employee_id, full_name, reporting_manager_id FROM associates LIMIT 10");
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($data as $row) {
    echo "ID: {$row['employee_id']}, Name: {$row['full_name']}, Reports To: " . ($row['reporting_manager_id'] ?? 'NULL') . "\n";
}

echo "\n=== CHECKING DEPARTMENT_HEADS TABLE ===\n";
$stmt = $pdo->query("DESCRIBE department_heads");
$columns = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Columns in department_heads:\n";
foreach ($columns as $col) {
    echo "  - {$col['Field']} ({$col['Type']})\n";
}

echo "\n=== SAMPLE DATA FROM DEPARTMENT_HEADS ===\n";
$stmt = $pdo->query("SELECT employee_id, full_name, reporting_manager_id FROM department_heads");
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($data as $row) {
    echo "ID: {$row['employee_id']}, Name: {$row['full_name']}, Reports To: " . ($row['reporting_manager_id'] ?? 'NULL') . "\n";
}

echo "\n=== CHECKING REPORTING RELATIONSHIPS ===\n";
$stmt = $pdo->query("SELECT reporting_manager_id, COUNT(*) as count FROM associates WHERE reporting_manager_id IS NOT NULL GROUP BY reporting_manager_id");
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "Associates grouped by reporting_manager_id:\n";
foreach ($data as $row) {
    echo "  Reports to '{$row['reporting_manager_id']}': {$row['count']} people\n";
}

echo "\n=== NULL REPORTING MANAGERS ===\n";
$stmt = $pdo->query("SELECT COUNT(*) as count FROM associates WHERE reporting_manager_id IS NULL OR reporting_manager_id = ''");
$count = $stmt->fetch();
echo "Associates with no manager: {$count['count']}\n";

echo "\n=== DEPARTMENT HEADS FULL INFO ===\n";
$stmt = $pdo->query("SELECT id, employee_id, full_name, reporting_manager_id FROM department_heads");
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);
foreach ($data as $row) {
    echo "DB_id={$row['id']}, employee_id='{$row['employee_id']}', name={$row['full_name']}, reports_to=" . ($row['reporting_manager_id'] ?? 'NULL') . "\n";
}

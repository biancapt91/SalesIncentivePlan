// =========================================
// config.js — Central API & Role Constants
// Loaded FIRST before all other modules.
// =========================================

/**
 * All PHP API endpoint URLs in one place.
 * Usage in any module: API.ASSOCIATES, API.AUTH, etc.
 */
window.API = Object.freeze({
    AUTH:               'api/auth.php',
    ASSOCIATES:         'api/associates.php',
    USERS:              'api/users.php',
    DEPARTMENT_HEADS:   'api/department_heads.php',
    EMPLOYMENT_HISTORY: 'api/employment_history.php',
    HOLIDAYS:           'api/holidays.php',
    KPI_ACTUALS:        'api/kpi_actuals.php',
    KPI_TARGETS:        'api/kpi_targets.php',
    NEW_CUSTOMER:       'api/new_customer.php',
    SIP_PAYMENT:        'api/sip_payment.php',
    SIP_REPORT:         'api/sip_report.php',
    SIP_TIERS:          'api/sip_tiers.php',
    SIP_UNLOCK_REQUEST: 'api/sip_unlock_request.php',
    AUDIT_LOG:          'api/audit_log.php',
});

/**
 * All user role strings in one place.
 * Usage: ROLES.ADMIN, ROLES.SALES_ASSOCIATE, etc.
 */
window.ROLES = Object.freeze({
    ADMIN:           'admin',
    SUPERVISOR:      'supervisor',
    SALES_ASSOCIATE: 'sales_associate',
    HEAD_ADMIN:      'head_admin',
    SALES_ADMIN:     'sales_admin',
});

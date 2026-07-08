-- ================================================
--  e-SIP | Sales Incentive Plan
--  Database Setup
--  Jalankan file ini di phpMyAdmin > Import
-- ================================================

CREATE DATABASE IF NOT EXISTS `db_esip`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `db_esip`;

-- -----------------------------------------------
--  Tabel: associates
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS `associates` (
  `id`          INT           NOT NULL AUTO_INCREMENT,
  `employee_id` VARCHAR(20)   NOT NULL,
  `full_name`   VARCHAR(100)  NOT NULL,
  `position`    VARCHAR(60)   NOT NULL,
  `level`       VARCHAR(60)   NOT NULL DEFAULT '',
  `category`    VARCHAR(60)   NOT NULL DEFAULT '',
  `plan`        VARCHAR(10)   NOT NULL DEFAULT '',
  `detail_area` VARCHAR(100)  NOT NULL,
  `group_area`  VARCHAR(100)  NOT NULL,
  `salary`          DECIMAL(15,2) NOT NULL DEFAULT 0,
  `target_nc`       INT           NOT NULL DEFAULT 0,
  `sip_budget_jan`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_feb`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_mar`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_apr`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_may`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_jun`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_jul`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_aug`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_sep`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_oct`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_nov`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget_dec`  DECIMAL(15,2) NOT NULL DEFAULT 0,
  `current_sip_percent` DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `resign_date`            DATE          NULL DEFAULT NULL,
  `reporting_manager_id`   VARCHAR(20)   NULL DEFAULT NULL,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee_id` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------
--  Sample Data
-- -----------------------------------------------
INSERT INTO `associates`
  (`employee_id`, `full_name`, `position`, `level`, `detail_area`, `group_area`, `salary`, `target_nc`,
   `sip_budget_jan`, `sip_budget_feb`, `sip_budget_mar`, `sip_budget_apr`,
   `sip_budget_may`, `sip_budget_jun`, `sip_budget_jul`, `sip_budget_aug`,
   `sip_budget_sep`, `sip_budget_oct`, `sip_budget_nov`, `sip_budget_dec`)
VALUES
  ('EMP-001','Andi Prasetyo',    'Sales Executive',        'L1','Jakarta Selatan','DKI Jakarta',       5500000,20, 1500000,1500000,1500000,1500000,1500000,1500000,1500000,1800000,1800000,1800000,1800000,1800000),
  ('EMP-002','Sari Dewi Utami',  'Senior Sales Executive', 'L2','Jakarta Utara',  'DKI Jakarta',       7000000,25, 2000000,2000000,2000000,2000000,2000000,2000000,2000000,2200000,2200000,2200000,2200000,2200000),
  ('EMP-003','Budi Santoso',     'Sales Supervisor',       'L3','Bandung Barat',  'Jawa Barat',        8500000,30, 2500000,2500000,2500000,2500000,2500000,2500000,2500000,2800000,2800000,2800000,2800000,2800000),
  ('EMP-004','Rini Anggraeni',   'Sales Executive',        'L1','Surabaya Timur', 'Jawa Timur',        5500000,18, 1200000,1200000,1200000,1200000,1200000,1200000,1200000,1400000,1400000,1400000,1400000,1400000),
  ('EMP-005','Dian Permana',     'Sales Manager',          'L4','Semarang',       'Jawa Tengah',      12000000,50, 4000000,4000000,4000000,4000000,4000000,4000000,4000000,4500000,4500000,4500000,4500000,4500000),
  ('EMP-006','Fitri Wulandari',  'Senior Sales Executive', 'L2','Depok',          'Jawa Barat',        6800000,22, 1800000,1800000,1800000,1800000,1800000,1800000,1800000,2000000,2000000,2000000,2000000,2000000),
  ('EMP-007','Ahmad Fauzi',      'Area Sales Manager',     'L5','Makassar',       'Sulawesi Selatan', 15000000,70, 5500000,5500000,5500000,5500000,5500000,5500000,5500000,6000000,6000000,6000000,6000000,6000000);

-- -----------------------------------------------
--  Tabel: employment_history
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS `employment_history` (
  `id`            INT           NOT NULL AUTO_INCREMENT,
  `employee_id`   VARCHAR(20)   NOT NULL,
  `position`       VARCHAR(60)   NOT NULL,
  `salary`         DECIMAL(15,2) NOT NULL DEFAULT 0,
  `sip_budget`     DECIMAL(15,2) NOT NULL DEFAULT 0,
  `effective_date` DATE         NOT NULL,
  `notes`         VARCHAR(255)  NOT NULL DEFAULT '',
  `created_at`    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_employee_id` (`employee_id`),
  CONSTRAINT `fk_history_associate`
    FOREIGN KEY (`employee_id`) REFERENCES `associates` (`employee_id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sample history data
INSERT INTO `employment_history` (`employee_id`, `position`, `salary`, `sip_budget`, `effective_date`, `notes`) VALUES
  ('EMP-001', 'Sales Executive',        5500000, 1500000, '2024-01-01', 'Posisi awal'),
  ('EMP-002', 'Sales Executive',        5500000, 1500000, '2023-01-01', 'Posisi awal'),
  ('EMP-002', 'Senior Sales Executive', 7000000, 2000000, '2024-06-01', 'Promosi'),
  ('EMP-003', 'Sales Executive',        5500000, 1500000, '2022-03-01', 'Posisi awal'),
  ('EMP-003', 'Senior Sales Executive', 7000000, 2000000, '2023-03-01', 'Promosi'),
  ('EMP-003', 'Sales Supervisor',       8500000, 2500000, '2024-09-01', 'Promosi'),
  ('EMP-005', 'Sales Executive',        5500000, 1500000, '2020-01-01', 'Posisi awal'),
  ('EMP-005', 'Sales Supervisor',       8500000, 2500000, '2021-07-01', 'Promosi'),
  ('EMP-005', 'Sales Manager',         12000000, 4000000, '2023-04-01', 'Promosi');

-- -----------------------------------------------
--  Tabel: new_customer_achievement
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS `new_customer_achievement` (
  `id`                  INT           NOT NULL AUTO_INCREMENT,
  `employee_id`         VARCHAR(20)   NOT NULL,
  `invoice_date`        DATE          NOT NULL,
  `actual_new_customer` INT           NOT NULL DEFAULT 0,
  `created_at`          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_nca_emp`  (`employee_id`),
  KEY `idx_nca_date` (`invoice_date`),
  CONSTRAINT `fk_nca_associate`
    FOREIGN KEY (`employee_id`) REFERENCES `associates` (`employee_id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------
--  Tabel: new_customer_names
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS `new_customer_names` (
  `id`             INT           NOT NULL AUTO_INCREMENT,
  `achievement_id` INT           NOT NULL,
  `customer_name`  VARCHAR(150)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ncn_ach` (`achievement_id`),
  CONSTRAINT `fk_ncn_achievement`
    FOREIGN KEY (`achievement_id`) REFERENCES `new_customer_achievement` (`id`)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

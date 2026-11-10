-- ============================================================================
-- File: database/database.sql
-- SmartOLT Clone - Production Database Schema & Seeder (MySQL 8.0 / MariaDB 10.6+)
-- Target Hardware: ZTE ZXA10 C320 / C300 (Firmware V2.1.0 & V1.2.5P3)
-- Dilengkapi Fitur: WAN Remote Access ACL & TR-069 (CWMP ACS Auto-Configuration)
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `smartolt_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `smartolt_db`;

-- ----------------------------------------------------------------------------
-- 1. Tabel: olts (Daftar Perangkat OLT ZTE C320 / C300)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `olts`;
CREATE TABLE `olts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `hardware_model` ENUM('ZTE-C320', 'ZTE-C300', 'ZTE-C600', 'ZTE-C620') NOT NULL DEFAULT 'ZTE-C320',
  `firmware_version` ENUM('V2.1.0', 'V1.2.5P3') NOT NULL DEFAULT 'V2.1.0',
  `ip_address` VARCHAR(45) NOT NULL,
  `telnet_port` INT UNSIGNED NOT NULL DEFAULT 23,
  `ssh_port` INT UNSIGNED NOT NULL DEFAULT 22,
  `protocol` ENUM('TELNET', 'SSH') NOT NULL DEFAULT 'TELNET',
  `olt_username` VARCHAR(64) NOT NULL,
  `olt_password` VARCHAR(128) NOT NULL,
  `enable_password` VARCHAR(128) DEFAULT NULL,
  `snmp_read_community` VARCHAR(64) NOT NULL DEFAULT 'public',
  `snmp_write_community` VARCHAR(64) NOT NULL DEFAULT 'private',
  `snmp_port` INT UNSIGNED NOT NULL DEFAULT 161,
  `uplink_interface` VARCHAR(50) NOT NULL DEFAULT 'gei_1/3/1',
  `location` VARCHAR(150) DEFAULT NULL,
  `temperature_c` DECIMAL(4,1) NOT NULL DEFAULT 38.5,
  `cpu_load_pct` INT UNSIGNED NOT NULL DEFAULT 14,
  `uptime_str` VARCHAR(100) NOT NULL DEFAULT '42 days, 11:24:09',
  `status` ENUM('ONLINE', 'OFFLINE', 'MAINTENANCE') NOT NULL DEFAULT 'ONLINE',
  `last_polled_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_olts_ip` (`ip_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Tabel: pon_ports (Daftar Port GPON pada Board GTGO / GTGH)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `pon_ports`;
CREATE TABLE `pon_ports` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `olt_id` INT UNSIGNED NOT NULL,
  `rack` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `shelf` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `slot` TINYINT UNSIGNED NOT NULL DEFAULT 2,
  `port_number` TINYINT UNSIGNED NOT NULL,
  `interface_name` VARCHAR(32) NOT NULL COMMENT 'Contoh: gpon-olt_1/2/1',
  `board_model` VARCHAR(32) NOT NULL DEFAULT 'GTGH',
  `description` VARCHAR(120) DEFAULT NULL,
  `admin_state` ENUM('ENABLED', 'DISABLED') NOT NULL DEFAULT 'ENABLED',
  `tx_power_dbm` DECIMAL(5,2) NOT NULL DEFAULT 5.20,
  `max_onu_capacity` INT UNSIGNED NOT NULL DEFAULT 128,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_olt_interface` (`olt_id`, `interface_name`),
  CONSTRAINT `fk_pon_ports_olt` FOREIGN KEY (`olt_id`) REFERENCES `olts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Tabel: vlans (Data Service VLAN PPPoE, Hotspot Bridge, VoIP, TR-069)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `vlans`;
CREATE TABLE `vlans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `olt_id` INT UNSIGNED NOT NULL,
  `vlan_id` SMALLINT UNSIGNED NOT NULL COMMENT 'Range 1 - 4094',
  `name` VARCHAR(80) NOT NULL,
  `description` VARCHAR(200) DEFAULT NULL,
  `service_type` ENUM('PPPOE', 'HOTSPOT_BRIDGE', 'DHCP', 'TR069_MGMT', 'IPTV') NOT NULL DEFAULT 'PPPOE',
  `svlan_id` SMALLINT UNSIGNED DEFAULT NULL,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_olt_vlan` (`olt_id`, `vlan_id`),
  CONSTRAINT `fk_vlans_olt` FOREIGN KEY (`olt_id`) REFERENCES `olts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Tabel: tcont_profiles (Profil DBA Upstream GPON T-CONT)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `tcont_profiles`;
CREATE TABLE `tcont_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_name` VARCHAR(64) NOT NULL,
  `dba_type` TINYINT UNSIGNED NOT NULL DEFAULT 4,
  `fixed_kbps` INT UNSIGNED NOT NULL DEFAULT 0,
  `assured_kbps` INT UNSIGNED NOT NULL DEFAULT 0,
  `maximum_kbps` INT UNSIGNED NOT NULL DEFAULT 1000000,
  `description` VARCHAR(150) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tcont_profile_name` (`profile_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. Tabel: speed_profiles (Profil Limitasi Traffic Gemport / Traffic-Profile)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `speed_profiles`;
CREATE TABLE `speed_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_name` VARCHAR(64) NOT NULL,
  `download_kbps` INT UNSIGNED NOT NULL,
  `upload_kbps` INT UNSIGNED NOT NULL,
  `cir_kbps` INT UNSIGNED NOT NULL DEFAULT 0,
  `cbs_bytes` INT UNSIGNED NOT NULL DEFAULT 1024,
  `pbs_bytes` INT UNSIGNED NOT NULL DEFAULT 2048,
  `tcont_profile_id` INT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_speed_profile_name` (`profile_name`),
  CONSTRAINT `fk_speed_tcont` FOREIGN KEY (`tcont_profile_id`) REFERENCES `tcont_profiles` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Tabel: tr069_profiles (Profil Server ACS CWMP TR-069)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `tr069_profiles`;
CREATE TABLE `tr069_profiles` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `profile_name` VARCHAR(80) NOT NULL,
  `acs_url` VARCHAR(255) NOT NULL COMMENT 'Contoh: http://acs.smartolt.id:7547/cwmp',
  `acs_username` VARCHAR(80) NOT NULL DEFAULT 'smartolt_acs',
  `acs_password` VARCHAR(120) NOT NULL DEFAULT 'acs_secret_2026',
  `connection_request_username` VARCHAR(80) NOT NULL DEFAULT 'cpe_conn',
  `connection_request_password` VARCHAR(120) NOT NULL DEFAULT 'cpe_pass_2026',
  `periodic_inform_interval` INT UNSIGNED NOT NULL DEFAULT 300 COMMENT 'Detik (misal 300s = 5 menit)',
  `mgmt_vlan_id` SMALLINT UNSIGNED NOT NULL DEFAULT 101,
  `is_default` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tr069_profile_name` (`profile_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. Tabel: zones (Wilayah / Area Coverage FTTH)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `zones`;
CREATE TABLE `zones` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `code` VARCHAR(24) NOT NULL,
  `city_district` VARCHAR(100) DEFAULT NULL,
  `description` VARCHAR(200) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_zone_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. Tabel: odbs (Optical Distribution Box / ODP Splitter Tiang)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `odbs`;
CREATE TABLE `odbs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `zone_id` INT UNSIGNED NOT NULL,
  `pon_port_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `splitter_ratio` ENUM('1:4', '1:8', '1:16', '1:32') NOT NULL DEFAULT '1:8',
  `total_ports` TINYINT UNSIGNED NOT NULL DEFAULT 8,
  `latitude` DECIMAL(10,7) DEFAULT NULL,
  `longitude` DECIMAL(10,7) DEFAULT NULL,
  `pole_number` VARCHAR(50) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_odb_name` (`name`),
  CONSTRAINT `fk_odbs_zone` FOREIGN KEY (`zone_id`) REFERENCES `zones` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_odbs_pon_port` FOREIGN KEY (`pon_port_id`) REFERENCES `pon_ports` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 9. Tabel: onus (Data Master ONU Terdaftar & Unconfigured + WAN Remote Access + TR069)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `onus`;
CREATE TABLE `onus` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `olt_id` INT UNSIGNED NOT NULL,
  `pon_port_id` INT UNSIGNED NOT NULL,
  `onu_index` SMALLINT UNSIGNED DEFAULT NULL,
  `serial_number` VARCHAR(24) NOT NULL,
  `onu_type` VARCHAR(40) NOT NULL DEFAULT 'ZTE-F670L',
  `is_authorized` TINYINT(1) NOT NULL DEFAULT 0,
  `customer_name` VARCHAR(120) DEFAULT NULL,
  `address` VARCHAR(255) DEFAULT NULL,
  `external_id` VARCHAR(64) DEFAULT NULL,
  `zone_id` INT UNSIGNED DEFAULT NULL,
  `odb_id` INT UNSIGNED DEFAULT NULL,
  `odb_port` TINYINT UNSIGNED DEFAULT NULL,
  `vlan_id` INT UNSIGNED DEFAULT NULL,
  `speed_profile_id` INT UNSIGNED DEFAULT NULL,
  `tcont_profile_id` INT UNSIGNED DEFAULT NULL,
  `onu_mode` ENUM('Routing', 'Bridging') NOT NULL DEFAULT 'Routing' COMMENT 'Mode Operasi ONU (Routing / Bridging)',
  `wan_mode` ENUM('PPPOE', 'DHCP', 'STATIC_IP', 'ONU_WEBPAGE', 'BRIDGE') NOT NULL DEFAULT 'PPPOE',
  `config_method` ENUM('OMCI', 'TR069') NOT NULL DEFAULT 'OMCI' COMMENT 'Metode Injeksi Konfigurasi WAN (OMCI / TR069 ACS)',
  `wan_remote_access` ENUM('Enabled from everywhere in the internet', 'Enabled only from NOC subnet', 'Disabled') NOT NULL DEFAULT 'Enabled from everywhere in the internet' COMMENT 'Status WAN Remote Access Web/HTTPS/Telnet/Ping',
  `wan_remote_allowed_subnet` VARCHAR(64) DEFAULT '0.0.0.0/0',
  `tr069_profile_id` INT UNSIGNED DEFAULT 1,
  `tr069_status` ENUM('ACTIVE_INFORMING', 'PENDING_INFORM', 'DISABLED') NOT NULL DEFAULT 'ACTIVE_INFORMING',
  `tr069_last_inform` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `wifi_ssid` VARCHAR(64) DEFAULT NULL,
  `wifi_password` VARCHAR(64) DEFAULT NULL,
  `pppoe_username` VARCHAR(80) DEFAULT NULL,
  `pppoe_password` VARCHAR(80) DEFAULT NULL,
  `static_ip_address` VARCHAR(45) DEFAULT NULL,
  `static_subnet_mask` VARCHAR(45) DEFAULT NULL,
  `static_gateway` VARCHAR(45) DEFAULT NULL,
  `static_dns1` VARCHAR(45) DEFAULT NULL,
  `hotspot_bridge_vlan` SMALLINT UNSIGNED DEFAULT NULL,
  `admin_state` ENUM('ENABLED', 'DISABLED') NOT NULL DEFAULT 'ENABLED',
  `phase_state` ENUM('working', 'LOS', 'DyingGasp', 'OffLine', 'syncMib', 'AuthFailed', 'Unconfigured') NOT NULL DEFAULT 'Unconfigured',
  `onu_rx_dbm` DECIMAL(5,2) DEFAULT NULL,
  `onu_tx_dbm` DECIMAL(5,2) DEFAULT NULL,
  `olt_rx_dbm` DECIMAL(5,2) DEFAULT NULL,
  `distance_m` INT UNSIGNED DEFAULT 0,
  `temperature_c` DECIMAL(4,1) DEFAULT 44.0,
  `ip_address` VARCHAR(45) DEFAULT NULL,
  `firmware_ver` VARCHAR(40) DEFAULT 'V7.1.10P1N12',
  `last_online_at` DATETIME DEFAULT NULL,
  `last_offline_reason` VARCHAR(80) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_onu_sn` (`serial_number`),
  UNIQUE KEY `uk_pon_onu_index` (`pon_port_id`, `onu_index`),
  CONSTRAINT `fk_onus_olt` FOREIGN KEY (`olt_id`) REFERENCES `olts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_onus_pon_port` FOREIGN KEY (`pon_port_id`) REFERENCES `pon_ports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_onus_zone` FOREIGN KEY (`zone_id`) REFERENCES `zones` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_onus_odb` FOREIGN KEY (`odb_id`) REFERENCES `odbs` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_onus_vlan` FOREIGN KEY (`vlan_id`) REFERENCES `vlans` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_onus_speed` FOREIGN KEY (`speed_profile_id`) REFERENCES `speed_profiles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_onus_tcont` FOREIGN KEY (`tcont_profile_id`) REFERENCES `tcont_profiles` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_onus_tr069` FOREIGN KEY (`tr069_profile_id`) REFERENCES `tr069_profiles` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 10. Tabel: provisioning_logs (Audit Log Eksekusi Script CLI OLT & TR-069 CWMP)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `provisioning_logs`;
CREATE TABLE `provisioning_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `olt_id` INT UNSIGNED NOT NULL,
  `onu_id` INT UNSIGNED DEFAULT NULL,
  `serial_number` VARCHAR(24) NOT NULL,
  `action_type` ENUM('AUTHORIZE', 'UPDATE_ONU_MODE', 'TR069_PUSH', 'REBOOT', 'RESYNC_CONFIG', 'FACTORY_RESET', 'UPDATE_PPPOE', 'DELETE_ONU', 'POLL_SIGNAL') NOT NULL,
  `interface_target` VARCHAR(48) NOT NULL,
  `cli_script` TEXT NOT NULL,
  `olt_response` TEXT DEFAULT NULL,
  `execution_status` ENUM('SUCCESS', 'FAILED', 'SIMULATED') NOT NULL DEFAULT 'SUCCESS',
  `executed_by` VARCHAR(64) NOT NULL DEFAULT 'admin@smartolt.local',
  `duration_ms` INT UNSIGNED NOT NULL DEFAULT 185,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_logs_sn` (`serial_number`),
  KEY `idx_logs_created` (`created_at`),
  CONSTRAINT `fk_logs_olt` FOREIGN KEY (`olt_id`) REFERENCES `olts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- DATA SEEDER
-- ============================================================================

INSERT INTO `olts` (`id`, `name`, `hardware_model`, `firmware_version`, `ip_address`, `telnet_port`, `ssh_port`, `protocol`, `olt_username`, `olt_password`, `enable_password`, `snmp_read_community`, `snmp_write_community`, `snmp_port`, `uplink_interface`, `location`, `temperature_c`, `cpu_load_pct`, `uptime_str`, `status`) VALUES
(1, 'OLT-PUSAT-C320-01', 'ZTE-C320', 'V2.1.0', '10.254.1.2', 23, 22, 'TELNET', 'zte', 'zte', 'zxr10', 'public_ro', 'private_rw', 161, 'gei_1/3/1', 'POP Sudirman NOC Rack A1', 39.2, 16, '89 days, 14:22:18', 'ONLINE'),
(2, 'OLT-CABANG-C300-02', 'ZTE-C300', 'V1.2.5P3', '10.254.1.3', 23, 22, 'TELNET', 'zte', 'zte', 'zxr10', 'public_ro', 'private_rw', 161, 'xgei_1/19/1', 'POP Kemang Distribution Shelter', 41.5, 22, '142 days, 06:11:45', 'ONLINE');

INSERT INTO `pon_ports` (`id`, `olt_id`, `rack`, `shelf`, `slot`, `port_number`, `interface_name`, `board_model`, `description`, `admin_state`, `tx_power_dbm`, `max_onu_capacity`) VALUES
(1, 1, 1, 1, 2, 1, 'gpon-olt_1/2/1', 'GTGH', 'Jalur Utama Sudirman Park & Karet', 'ENABLED', 5.45, 128),
(2, 1, 1, 1, 2, 2, 'gpon-olt_1/2/2', 'GTGH', 'Jalur Setiabudi Timur & Kuningan', 'ENABLED', 5.30, 128),
(3, 1, 1, 1, 2, 3, 'gpon-olt_1/2/3', 'GTGH', 'Jalur Bendungan Hilir Residence', 'ENABLED', 5.18, 128),
(4, 2, 1, 1, 3, 1, 'gpon-olt_1/3/1', 'GTGO', 'Jalur Kemang Pratama & Bangka', 'ENABLED', 5.10, 128);

INSERT INTO `vlans` (`id`, `olt_id`, `vlan_id`, `name`, `description`, `service_type`, `svlan_id`, `is_default`) VALUES
(1, 1, 101, 'PPOE', 'VLAN 101 - PPOE (Sesuai Konfigurasi SmartOLT Utama)', 'PPPOE', NULL, 1),
(2, 1, 111, 'VLAN-111-PPPOE-HOME', 'VLAN Layanan FTTH PPPoE Residential via OMCI/TR069', 'PPPOE', NULL, 0),
(3, 1, 200, 'VLAN-200-HOTSPOT-VOUCHER', 'VLAN Bridge Murni untuk MikroTik Hotspot Voucher Server', 'HOTSPOT_BRIDGE', NULL, 0),
(4, 1, 300, 'VLAN-300-CORPORATE-DHCP', 'VLAN Dedicated Corporate Metro IPoE/DHCP', 'DHCP', NULL, 0),
(5, 1, 409, 'VLAN-409-TR069-ACS', 'VLAN Management Dedicated TR-069 CWMP GenieACS', 'TR069_MGMT', NULL, 0);

INSERT INTO `tr069_profiles` (`id`, `profile_name`, `acs_url`, `acs_username`, `acs_password`, `connection_request_username`, `connection_request_password`, `periodic_inform_interval`, `mgmt_vlan_id`, `is_default`) VALUES
(1, 'SmartOLT-GenieACS-Primary', 'http://acs.smartolt.id:7547/cwmp', 'smartolt_acs', 'jetcyber_acs_2026', 'cpe_req_admin', 'cpe_req_pass88', 300, 101, 1),
(2, 'Dedicated-TR069-VLAN409', 'http://10.254.250.10:7547/acs', 'zte_cwmp', 'zte_cwmp_pass', 'zte_conn', 'zte_conn_123', 600, 409, 0);

SET FOREIGN_KEY_CHECKS = 1;

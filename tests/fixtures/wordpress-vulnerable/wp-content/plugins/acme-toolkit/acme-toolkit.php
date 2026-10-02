<?php
/**
 * Plugin Name: Acme Toolkit
 * Description: Forms, entries, link previews and WooCommerce extras.
 * Version: 2.3.1
 * Requires at least: 6.9
 * Author: Acme
 * Text Domain: acme-toolkit
 */

defined( 'ABSPATH' ) || exit;

define( 'ACME_VERSION', '2.3.1' );
define( 'ACME_DIR', plugin_dir_path( __FILE__ ) );
define( 'ACME_URL', plugin_dir_url( __FILE__ ) );
define( 'ACME_API_SECRET', 'acme-live-0000-EXAMPLE-SECRET-DO-NOT-USE' );

require_once ACME_DIR . 'includes/admin.php';
require_once ACME_DIR . 'includes/ajax.php';
require_once ACME_DIR . 'includes/rest.php';
require_once ACME_DIR . 'includes/frontend.php';

if ( class_exists( 'WooCommerce' ) ) {
	require_once ACME_DIR . 'includes/woocommerce.php';
}

register_activation_hook( __FILE__, function () {
	global $wpdb;
	$charset = $wpdb->get_charset_collate();
	require_once ABSPATH . 'wp-admin/includes/upgrade.php';
	dbDelta( "CREATE TABLE {$wpdb->prefix}acme_entries (
		id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
		user_id bigint(20) unsigned NOT NULL DEFAULT 0,
		name varchar(191) NOT NULL,
		email varchar(191) NOT NULL,
		message text NOT NULL,
		created_at datetime NOT NULL,
		PRIMARY KEY  (id)
	) $charset;" );
} );

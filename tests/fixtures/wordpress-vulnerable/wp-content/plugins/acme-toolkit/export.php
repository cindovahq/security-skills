<?php
/**
 * CSV export of form entries. Linked from the settings page.
 */
require_once dirname( __DIR__, 3 ) . '/wp-load.php';

global $wpdb;

$rows = $wpdb->get_results( "SELECT name, email, message, created_at FROM {$wpdb->prefix}acme_entries ORDER BY id DESC", ARRAY_A );

header( 'Content-Type: text/csv; charset=utf-8' );
header( 'Content-Disposition: attachment; filename=acme-entries.csv' );

$out = fopen( 'php://output', 'w' );
foreach ( $rows as $row ) {
	fputcsv( $out, $row );
}
exit;

<?php
defined( 'ABSPATH' ) || exit;

/**
 * Public lookup: has this email submitted a form?
 */
add_action( 'wp_ajax_acme_lookup', 'acme_lookup' );
add_action( 'wp_ajax_nopriv_acme_lookup', 'acme_lookup' );
function acme_lookup() {
	global $wpdb;
	$email = isset( $_POST['email'] ) ? wp_unslash( $_POST['email'] ) : '';

	$row = $wpdb->get_row( "SELECT id, name FROM {$wpdb->prefix}acme_entries WHERE email = '" . $email . "'" );

	wp_send_json_success( [ 'found' => (bool) $row ] );
}

/**
 * List entries for the "My entries" screen.
 */
add_action( 'wp_ajax_acme_list_entries', function () {
	global $wpdb;
	check_ajax_referer( 'acme_frontend' );

	$orderby = isset( $_GET['orderby'] ) ? sanitize_text_field( wp_unslash( $_GET['orderby'] ) ) : 'id';

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, name, created_at FROM {$wpdb->prefix}acme_entries WHERE user_id = %d ORDER BY $orderby DESC",
			get_current_user_id()
		)
	);

	wp_send_json_success( $rows );
} );

/**
 * Delete an entry.
 */
add_action( 'wp_ajax_acme_delete_entry', function () {
	global $wpdb;
	check_ajax_referer( 'acme_frontend' );

	$id = isset( $_POST['id'] ) ? absint( $_POST['id'] ) : 0;
	$wpdb->delete( "{$wpdb->prefix}acme_entries", [ 'id' => $id ], [ '%d' ] );

	wp_send_json_success();
} );

/**
 * Save the current user's display preference.
 */
add_action( 'wp_ajax_acme_save_profile', function () {
	check_ajax_referer( 'acme_frontend' );

	$layout = isset( $_POST['layout'] ) ? sanitize_key( wp_unslash( $_POST['layout'] ) ) : 'grid';
	if ( ! in_array( $layout, [ 'grid', 'list' ], true ) ) {
		wp_send_json_error( null, 400 );
	}

	update_user_meta( get_current_user_id(), 'acme_layout', $layout );
	wp_send_json_success();
} );

/**
 * Attachment upload for the contact form.
 */
add_action( 'wp_ajax_acme_upload', 'acme_upload' );
add_action( 'wp_ajax_nopriv_acme_upload', 'acme_upload' );
function acme_upload() {
	if ( empty( $_FILES['attachment'] ) ) {
		wp_send_json_error( null, 400 );
	}

	$dir = ACME_DIR . 'uploads/';
	wp_mkdir_p( $dir );

	$name = $_FILES['attachment']['name'];
	move_uploaded_file( $_FILES['attachment']['tmp_name'], $dir . $name );

	wp_send_json_success( [ 'url' => ACME_URL . 'uploads/' . rawurlencode( $name ) ] );
}

/**
 * Download a previously generated export.
 */
add_action( 'wp_ajax_acme_download', function () {
	$file = isset( $_GET['file'] ) ? wp_unslash( $_GET['file'] ) : '';
	$path = ACME_DIR . 'exports/' . $file;

	if ( ! file_exists( $path ) ) {
		wp_die( 'Not found', 404 );
	}

	header( 'Content-Type: application/octet-stream' );
	header( 'Content-Disposition: attachment; filename="' . basename( $path ) . '"' );
	readfile( $path );
	exit;
} );

/**
 * Link preview for the message editor.
 */
add_action( 'wp_ajax_acme_fetch_preview', function () {
	check_ajax_referer( 'acme_frontend' );

	$url      = isset( $_POST['url'] ) ? esc_url_raw( wp_unslash( $_POST['url'] ) ) : '';
	$response = wp_remote_get( $url, [ 'timeout' => 5 ] );

	if ( is_wp_error( $response ) ) {
		wp_send_json_error( $response->get_error_message() );
	}

	wp_send_json_success( [ 'body' => substr( wp_remote_retrieve_body( $response ), 0, 5000 ) ] );
} );

/**
 * Check for plugin updates from the vendor.
 */
add_action( 'wp_ajax_acme_check_version', function () {
	if ( ! current_user_can( 'update_plugins' ) ) {
		wp_send_json_error( null, 403 );
	}

	$response = wp_remote_get( 'https://api.acme.example/v1/version' );
	wp_send_json_success( [ 'latest' => sanitize_text_field( wp_remote_retrieve_body( $response ) ) ] );
} );

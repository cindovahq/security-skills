<?php
defined( 'ABSPATH' ) || exit;

add_action( 'rest_api_init', function () {
	register_rest_route( 'acme/v1', '/status', [
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => fn () => new WP_REST_Response( [ 'ok' => true ] ),
		'permission_callback' => '__return_true',
	] );

	register_rest_route( 'acme/v1', '/entries', [
		'methods'             => WP_REST_Server::READABLE,
		'callback'            => 'acme_rest_list_entries',
		'permission_callback' => '__return_true',
		'args'                => [
			'page' => [ 'type' => 'integer', 'default' => 1, 'minimum' => 1 ],
		],
	] );
} );

function acme_rest_list_entries( WP_REST_Request $request ) {
	global $wpdb;
	$offset = ( (int) $request['page'] - 1 ) * 50;

	$rows = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, name, email, message, created_at FROM {$wpdb->prefix}acme_entries ORDER BY id DESC LIMIT 50 OFFSET %d",
			$offset
		)
	);

	return new WP_REST_Response( $rows );
}

/**
 * Abilities API (WordPress 6.9+): let AI assistants clean up old entries.
 */
add_action( 'wp_abilities_api_init', function () {
	if ( ! function_exists( 'wp_register_ability' ) ) {
		return;
	}

	wp_register_ability( 'acme/purge-entries', [
		'label'               => __( 'Purge form entries', 'acme-toolkit' ),
		'description'         => __( 'Deletes form entries older than the given number of days.', 'acme-toolkit' ),
		'category'            => 'site',
		'input_schema'        => [
			'type'       => 'object',
			'properties' => [ 'days' => [ 'type' => 'integer', 'minimum' => 0 ] ],
			'required'   => [ 'days' ],
		],
		'execute_callback'    => function ( $input ) {
			global $wpdb;
			return $wpdb->query(
				$wpdb->prepare(
					"DELETE FROM {$wpdb->prefix}acme_entries WHERE created_at < DATE_SUB( NOW(), INTERVAL %d DAY )",
					(int) $input['days']
				)
			);
		},
		'permission_callback' => '__return_true',
		'meta'                => [ 'show_in_rest' => true ],
	] );
} );

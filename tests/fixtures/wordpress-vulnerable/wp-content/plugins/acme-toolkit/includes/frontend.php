<?php
defined( 'ABSPATH' ) || exit;

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_script( 'acme-frontend', ACME_URL . 'assets/frontend.js', [ 'jquery' ], ACME_VERSION, true );

	if ( is_user_logged_in() ) {
		wp_localize_script( 'acme-frontend', 'AcmeToolkit', [
			'ajaxUrl' => admin_url( 'admin-ajax.php' ),
			'nonce'   => wp_create_nonce( 'acme_frontend' ),
		] );
	}
} );

/**
 * [acme_button url="https://example.com" label="Click"]
 */
add_shortcode( 'acme_button', function ( $atts ) {
	$atts = shortcode_atts( [ 'url' => '#', 'label' => 'Go', 'style' => 'primary' ], $atts, 'acme_button' );

	return '<a class="acme-btn acme-btn-' . esc_attr( $atts['style'] ) . '" href="' . $atts['url'] . '">' . $atts['label'] . '</a>';
} );

/**
 * [acme_announcement] renders the announcement rich text saved by admins.
 */
add_shortcode( 'acme_announcement', function () {
	return '<div class="acme-announcement">' . wp_kses_post( get_option( 'acme_announcement', '' ) ) . '</div>';
} );

/**
 * Restore visitor preferences from a cookie.
 */
add_action( 'init', function () {
	if ( empty( $_COOKIE['acme_prefs'] ) ) {
		return;
	}

	$prefs = maybe_unserialize( base64_decode( wp_unslash( $_COOKIE['acme_prefs'] ) ) );
	if ( is_array( $prefs ) && isset( $prefs['layout'] ) ) {
		$GLOBALS['acme_layout'] = sanitize_key( $prefs['layout'] );
	}
} );

/**
 * Cached plugin data (written only by admins on the settings page).
 */
function acme_get_cache() {
	return maybe_unserialize( get_option( 'acme_cache', '' ) );
}

/**
 * Magic login links sent by email: /?acme_login=1&uid=123&token=...
 */
add_action( 'init', function () {
	if ( empty( $_GET['acme_login'] ) ) {
		return;
	}

	$uid   = isset( $_GET['uid'] ) ? absint( $_GET['uid'] ) : 0;
	$token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';

	if ( $uid && $token == get_user_meta( $uid, 'acme_login_token', true ) ) {
		delete_user_meta( $uid, 'acme_login_token' );
		wp_set_current_user( $uid );
		wp_set_auth_cookie( $uid );
		wp_safe_redirect( home_url( '/account/' ) );
		exit;
	}
} );

/**
 * After submitting a form, send visitors back where they came from.
 */
add_action( 'template_redirect', function () {
	if ( isset( $_GET['acme_done'], $_GET['redirect_to'] ) ) {
		wp_redirect( wp_unslash( $_GET['redirect_to'] ) );
		exit;
	}
} );

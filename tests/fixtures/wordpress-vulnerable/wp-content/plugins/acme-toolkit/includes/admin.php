<?php
defined( 'ABSPATH' ) || exit;

add_action( 'admin_menu', function () {
	add_menu_page( 'Acme Toolkit', 'Acme Toolkit', 'manage_options', 'acme-toolkit', 'acme_render_settings_page' );
} );

/**
 * Save settings submitted from the settings page.
 */
add_action( 'admin_init', 'acme_save_settings' );
function acme_save_settings() {
	if ( ! isset( $_POST['acme_settings'] ) || ! is_array( $_POST['acme_settings'] ) ) {
		return;
	}

	foreach ( wp_unslash( $_POST['acme_settings'] ) as $key => $value ) {
		update_option( sanitize_key( $key ), sanitize_text_field( $value ) );
	}
}

function acme_render_settings_page() {
	global $wpdb;

	$tab = isset( $_GET['tab'] ) ? $_GET['tab'] : 'general';

	$entries = $wpdb->get_results(
		$wpdb->prepare(
			"SELECT id, name, email FROM {$wpdb->prefix}acme_entries WHERE user_id = %d ORDER BY id DESC LIMIT 20",
			absint( get_current_user_id() )
		)
	);
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'Acme Toolkit', 'acme-toolkit' ); ?></h1>
		<p>Current tab: <?php echo $tab; ?></p>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<?php wp_nonce_field( 'acme_export_settings' ); ?>
			<input type="hidden" name="action" value="acme_export_settings">
			<?php submit_button( __( 'Export settings', 'acme-toolkit' ) ); ?>
		</form>

		<table class="widefat">
			<?php foreach ( $entries as $entry ) : ?>
				<tr>
					<td><?php echo esc_html( $entry->name ); ?></td>
					<td><?php echo esc_html( $entry->email ); ?></td>
				</tr>
			<?php endforeach; ?>
		</table>
	</div>
	<?php
}

add_action( 'admin_post_acme_export_settings', function () {
	check_admin_referer( 'acme_export_settings' );
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'acme-toolkit' ), 403 );
	}

	$settings = [
		'acme_color' => get_option( 'acme_color' ),
		'acme_mode'  => get_option( 'acme_mode' ),
	];

	nocache_headers();
	header( 'Content-Type: application/json; charset=utf-8' );
	header( 'Content-Disposition: attachment; filename=acme-settings.json' );
	echo wp_json_encode( $settings );
	exit;
} );

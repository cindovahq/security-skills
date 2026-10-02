import subprocess

from celery import shared_task


@shared_task
def export_tickets(owner_id, archive_name):
    subprocess.run(
        f"tar czf /var/exports/{archive_name}.tgz -C /var/data/{owner_id} .",
        shell=True,
        check=True,
    )


@shared_task
def make_thumbnail(src_path, dst_path):
    subprocess.run(["convert", src_path, "-resize", "200x200", dst_path], check=True)

from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email


class Command(BaseCommand):
    help = "Create a staff account; the password is entered privately in the terminal."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            raise CommandError("Enter a valid email address.")
        if len(email) > 150:
            raise CommandError("Email must be at most 150 characters.")
        users = get_user_model().objects
        if users.filter(email__iexact=email).exists() or users.filter(username__iexact=email).exists():
            raise CommandError("This account already exists. Use changepassword to change its password.")
        user = get_user_model()(username=email, email=email, is_staff=True, is_active=True)
        password = getpass("Password: ")
        if password != getpass("Password again: "):
            raise CommandError("Passwords do not match.")
        try:
            validate_password(password, user)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages))
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS("Admin account created."))

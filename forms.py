from flask_wtf import FlaskForm
from wtforms import (
    StringField,
    PasswordField,
    SelectField,
    BooleanField,
    IntegerField,
    FileField,
)
from wtforms.validators import DataRequired, Length, Optional, EqualTo, ValidationError
from wtforms.validators import Regexp


class LoginForm(FlaskForm):
    username = StringField("Имя пользователя", validators=[DataRequired()])
    password = PasswordField("Пароль", validators=[DataRequired()])


class RegisterForm(FlaskForm):
    username = StringField(
        "Имя пользователя", validators=[DataRequired(), Length(min=3, max=64)]
    )
    password = PasswordField(
        "Пароль",
        validators=[
            DataRequired(),
            Length(min=8),
            Regexp(
                r"^(?=.*[A-Za-z])(?=.*\d)",
                message="Пароль должен содержать хотя бы одну букву и одну цифру",
            ),
        ],
    )
    confirm = PasswordField(
        "Подтверждение пароля",
        validators=[DataRequired(), EqualTo("password", message="Пароли не совпадают")],
    )


class CreateUserForm(FlaskForm):
    username = StringField(
        "Имя пользователя", validators=[DataRequired(), Length(min=3, max=64)]
    )
    password = PasswordField("Пароль", validators=[DataRequired(), Length(min=8)])
    role = SelectField(
        "Роль",
        choices=[
            ("user", "Пользователь"),
            ("operator", "Оператор"),
            ("admin", "Администратор"),
        ],
        validators=[DataRequired()],
    )


class EditUserForm(FlaskForm):
    username = StringField(
        "Имя пользователя", validators=[DataRequired(), Length(min=3, max=64)]
    )
    password = PasswordField("Пароль", validators=[Optional()])
    role = SelectField(
        "Роль",
        choices=[
            ("user", "Пользователь"),
            ("operator", "Оператор"),
            ("admin", "Администратор"),
        ],
        validators=[DataRequired()],
    )


class DeviceTypeForm(FlaskForm):
    name = StringField("Название", validators=[DataRequired()])
    width = IntegerField("Ширина", validators=[Optional()])
    height = IntegerField("Высота", validators=[Optional()])
    icon = FileField("Иконка", validators=[Optional()])


class SettingsForm(FlaskForm):
    ping_count = IntegerField("Количество пакетов", validators=[DataRequired()])
    ping_interval = IntegerField("Интервал опроса (сек)", validators=[DataRequired()])

"""Keep Telegram conversations in the ordinary agent thread list."""
from alembic import op
import sqlalchemy as sa
revision = "f7a9d1c3b205"
down_revision = "e4c9a7b2d610"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("thread", sa.Column("origin", sa.String(), nullable=False, server_default="app"))

def downgrade():
    op.drop_column("thread", "origin")

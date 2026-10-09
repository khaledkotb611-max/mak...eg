class BusinessRouter:
    def db_for_read(self, model, **hints):
        return 'business' if model._meta.label_lower=='mak_backend.product' else None

    db_for_write = db_for_read

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if db=='business':return False
        if app_label=='mak_backend' and model_name=='product':return False
        return None

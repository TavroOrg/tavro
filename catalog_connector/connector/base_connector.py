class BaseConnector:
    def authenticate(self):
        raise NotImplementedError

    def fetch_metadata(self):
        raise NotImplementedError

    def fetch_components(self, bot_id):
        return {}

    def execute(self):
        raise NotImplementedError
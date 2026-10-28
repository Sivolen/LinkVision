"""Regression checks for the sidebar layout and existing permission gates."""


from html.parser import HTMLParser


class SidebarSectionParents(HTMLParser):
    """Record the direct parent of each major sidebar section."""

    VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__()
        self.stack = []
        self.parents = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = set((attrs.get("class") or "").split())
        section = classes & {"sidebar-maps", "admin-menu", "sidebar-footer"}
        for name in section:
            self.parents[name] = self.stack[-1][1] if self.stack else set()
        if tag not in self.VOID_TAGS:
            self.stack.append((tag, classes))

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break


def test_admin_sidebar_keeps_actions_routes_and_active_admin_page(client, login):
    login("admin")
    response = client.get("/admin/users")
    assert response.status_code == 200
    html = response.get_data(as_text=True)

    assert 'class="sidebar-map-actions"' in html
    assert 'data-bs-target="#createMapModal"' in html
    assert "onclick=\"importMapNew()\"" in html
    assert "onclick=\"createFolderPrompt(null)\"" in html
    assert 'href="/admin/users"' in html
    assert 'aria-current="page"' in html
    assert 'aria-label="Переключить боковую панель"' in html
    assert 'action="/auth/logout"' in html
    assert 'action="/set-language/en"' in html

    sections = SidebarSectionParents()
    sections.feed(html)
    assert sections.parents["sidebar-maps"] == {"sidebar"}
    assert sections.parents["admin-menu"] == {"sidebar"}
    assert sections.parents["sidebar-footer"] == {"sidebar"}


def test_regular_user_sees_only_allowed_sidebar_actions(client, login, map_ids):
    login("testuser")
    response = client.get(f"/map/{map_ids['Own Map']}")
    assert response.status_code == 200
    html = response.get_data(as_text=True)

    assert "sidebar-map-actions" not in html
    assert "admin-menu" not in html
    assert f"window.currentMapId = {map_ids['Own Map']};" in html

window.JUFLOW_AUTH_READY = (async () => {
  document.documentElement.style.visibility = "hidden";
  try {
    const r = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!r.ok) throw new Error("unauth");
    window.JUFLOW_USER = (await r.json()).user;
    document.documentElement.style.visibility = "";
    return window.JUFLOW_USER;
  } catch (e) {
    location.replace("/login.html?next=" + encodeURIComponent(location.pathname));
    return null;
  }
})();
window.juflowLogout = async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  location.replace("/login.html");
};

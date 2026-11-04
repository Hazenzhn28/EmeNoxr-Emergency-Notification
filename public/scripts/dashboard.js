const main = document.querySelector(".dashboard-layout");
const logoutButton = document.querySelector("#logout-button");
const userName = document.querySelector("#user-name");
const sessionError = document.querySelector("#session-error");

function goToLogin() {
  window.location.replace("/login.html");
}

async function verifySession() {
  try {
    const response = await fetch("/api/auth/me", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });

    if (response.status === 401) {
      goToLogin();
      return;
    }
    if (!response.ok) {
      throw new Error("Unexpected status");
    }

    const { user } = await response.json();
    // textContent (not innerHTML) so a name can never inject markup.
    userName.textContent = user.fullName || user.email;
    userName.hidden = false;
    main.hidden = false;
  } catch {
    // Network or server problem: don't reveal the dashboard, and don't bounce to
    // login either, since the session itself may be perfectly valid.
    sessionError.textContent = "Could not verify your session. Refresh the page to try again.";
    sessionError.hidden = false;
  }
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  logoutButton.textContent = "Signing out…";
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("Logout failed");
    goToLogin();
  } catch {
    // Don't pretend the user is logged out if the cookie wasn't cleared.
    logoutButton.disabled = false;
    logoutButton.textContent = "Logout failed, retry";
  }
});

void verifySession();
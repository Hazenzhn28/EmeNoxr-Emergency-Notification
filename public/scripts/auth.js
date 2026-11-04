// Shared by login.html and register.html. Which form is on the page decides the behavior.
const form = document.querySelector("#login-form, #register-form");

if (form) {
  const isRegister = form.id === "register-form";
  const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";

  const emailInput = form.querySelector("#email");
  const passwordInput = form.querySelector("#password");
  const fullNameInput = form.querySelector("#fullName"); // only exists on the register page
  const errorBox = document.querySelector("#error-message");
  const submitButton = form.querySelector("#submit-button");
  const idleLabel = submitButton.textContent;

  function showError(message) {
    errorBox.textContent = message;
  }

  // Returns an error message, or null if the form looks valid.
  function validate(email, password) {
    if (!email) return "Enter your email address.";
    if (!emailInput.checkValidity()) return "Enter a valid email address.";
    if (!password) return "Enter your password.";
    if (isRegister && password.length < 12) return "Password must be at least 12 characters.";
    return null;
  }

  function messageFromResponse(status, data) {
    if (status === 429) {
      return data?.error || "Too many attempts. Please try again later.";
    }
    // Zod validation failures arrive as { error, details: [{ field, message }] }.
    if (Array.isArray(data?.details) && data.details.length > 0) {
      return data.details.map(detail => detail.message).join(" ");
    }
    return data?.error || "Something went wrong. Please try again.";
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    showError("");

    const email = emailInput.value.trim();
    const password = passwordInput.value; // never trimmed: spaces may be intentional

    const problem = validate(email, password);
    if (problem) {
      showError(problem);
      return;
    }

    const body = { email, password };
    if (isRegister) {
      // The backend rejects an empty fullName, so leave it out entirely when blank.
      const fullName = fullNameInput?.value.trim();
      if (fullName) body.fullName = fullName;
    }

    submitButton.disabled = true;
    submitButton.textContent = isRegister ? "Creating account…" : "Signing in…";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);

      if (response.ok) {
        // Cookie is already set by the server. replace() keeps /login.html out of Back history.
        window.location.replace("/");
        return;
      }

      showError(messageFromResponse(response.status, data));
    } catch {
      showError("Could not reach the server. Check your connection and try again.");
    }

    submitButton.disabled = false;
    submitButton.textContent = idleLabel;
    passwordInput.focus();
  });
}
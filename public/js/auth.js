// SIGN UP
const signupBtn = document.getElementById("signupBtn");
if (signupBtn) {
  signupBtn.addEventListener("click", async () => {
    try {
      const name = document.getElementById("name").value;
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;

      const userCredential = await auth.createUserWithEmailAndPassword(email, password);

      await db.collection("users").doc(userCredential.user.uid).set({
        name,
        email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      alert("Account created successfully!");
      window.location.href = "login.html";
    } catch (error) {
      alert(error.message);
    }
  });
}

// LOGIN
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    try {
      const email = document.getElementById("email").value;
      const password = document.getElementById("password").value;

      await auth.signInWithEmailAndPassword(email, password);

      window.location.href = "profile.html";
    } catch (error) {
      alert(error.message);
    }
  });
}

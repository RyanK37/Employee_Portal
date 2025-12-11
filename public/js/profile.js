// profile.js
// Assumes firebaseConfig.js defines `auth` and `db` globals.

(async function(){
  // redirect if not signed in
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    const uid = user.uid;
    const topName = document.getElementById('topName');
    const topEmail = document.getElementById('topEmail');
    const topAvatar = document.getElementById('topAvatar');
    const avatar = document.getElementById('avatar');
    const userName = document.getElementById('userName');
    const userEmailText = document.getElementById('userEmailText');
    const userJob = document.getElementById('userJob');
    const userPhone = document.getElementById('userPhone');
    const activityList = document.getElementById('activityList');

    const inputName = document.getElementById('inputName');
    const inputJob = document.getElementById('inputJob');
    const inputPhone = document.getElementById('inputPhone');
    const inputPhoto = document.getElementById('inputPhoto');
    const saveBtn = document.getElementById('saveProfileBtn');
    const editBtn = document.getElementById('editProfileBtn');
    const navLogout = document.getElementById('nav-logout');

    navLogout.addEventListener('click', async (e) => {
      e.preventDefault();
      await auth.signOut();
      window.location.href = "login.html";
    });

    // fetch user doc
    const userDocRef = db.collection('users').doc(uid);

    const doc = await userDocRef.get();
    let data = {};
    if (doc.exists) {
      data = doc.data();
    } else {
      // create minimal doc
      data = { name: user.displayName || "", email: user.email || "", createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await userDocRef.set(data);
    }

    // render profile
    topName.textContent = data.name || user.email;
    topEmail.textContent = data.email || user.email;
    userName.textContent = data.name || user.email;
    userEmailText.textContent = data.email || user.email;
    userJob.textContent = "Job title: " + (data.jobTitle || "—");
    userPhone.textContent = "Phone: " + (data.phone || "—");

    if (data.profileImage) {
      topAvatar.src = data.profileImage;
      avatar.src = data.profileImage;
    }

    // recent activity (placeholder): show createdAt
    activityList.innerHTML = "";
    if (data.createdAt && data.createdAt.toDate) {
      const d = data.createdAt.toDate();
      activityList.innerHTML = `<div>Joined: ${d.toLocaleString()}</div>`;
    } else {
      activityList.innerHTML = `<div>No recent activity recorded.</div>`;
    }

    // load inputs
    inputName.value = data.name || "";
    inputJob.value = data.jobTitle || "";
    inputPhone.value = data.phone || "";

    // allow edit focus
    editBtn.addEventListener('click', () => {
      window.scrollTo({top:0, behavior:'smooth'});
    });

    // helper: convert file to base64
    function fileToBase64(file){
      return new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
    }

    saveBtn.addEventListener('click', async () => {
      try {
        saveBtn.disabled = true;
        const updated = {
          name: inputName.value || "",
          jobTitle: inputJob.value || "",
          phone: inputPhone.value || "",
          email: user.email
        };

        if (inputPhoto.files && inputPhoto.files[0]) {
          const b64 = await fileToBase64(inputPhoto.files[0]);
          updated.profileImage = b64; 
        }

        await userDocRef.set(updated, { merge: true });

        // reflect in UI
        topName.textContent = updated.name || user.email;
        userName.textContent = updated.name || user.email;
        userJob.textContent = "Job title: " + (updated.jobTitle || "—");
        userPhone.textContent = "Phone: " + (updated.phone || "—");
        if (updated.profileImage) {
          avatar.src = updated.profileImage;
          topAvatar.src = updated.profileImage;
        }

        alert("Profile saved.");
      } catch (err) {
        console.error(err);
        alert("Error saving profile: " + err.message);
      } finally {
        saveBtn.disabled = false;
      }
    });
  });
})();

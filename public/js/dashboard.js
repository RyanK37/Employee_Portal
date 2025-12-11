// Dashboard logic: announcements + leave requests
(function () {
  const announcementsEl = document.getElementById("announcements");
  const yourRequestsEl = document.getElementById("yourRequests");
  const pendingWrap = document.getElementById("pendingApprovalsWrap");
  const pendingEl = document.getElementById("pendingApprovals");

  const leaveType = document.getElementById("leaveType");
  const leaveFrom = document.getElementById("leaveFrom");
  const leaveTo = document.getElementById("leaveTo");
  const leaveReason = document.getElementById("leaveReason");
  const submitLeaveBtn = document.getElementById("submitLeave");

  const adminControls = document.getElementById("adminControls");
  const composerWrap = document.getElementById("composerWrap");
  const openComposer = document.getElementById("openComposer");
  const cancelAnnouncement = document.getElementById("cancelAnnouncement");
  const postAnnouncement = document.getElementById("postAnnouncement");
  const announceTitle = document.getElementById("announceTitle");
  const announceBody = document.getElementById("announceBody");

  const topName = document.getElementById("topName");
  const topEmail = document.getElementById("topEmail");
  const topAvatar = document.getElementById("topAvatar");
  const navLogout = document.getElementById("nav-logout");

  // Profile edit inputs
  const profileAvatar = document.getElementById("profileAvatar");
  const profileNameDisplay = document.getElementById("profileNameDisplay");
  const profileEmailDisplay = document.getElementById("profileEmailDisplay");
  const profilePhoto = document.getElementById("profilePhoto");
  const profileNameInput = document.getElementById("profileName");
  const profileJobInput = document.getElementById("profileJob");
  const profilePhoneInput = document.getElementById("profilePhone");
  const saveProfileBtn = document.getElementById("saveProfile");

  let currentUser = null;
  let userProfile = {};
  let isAdmin = false;
  let annUnsub = null;
  let myReqUnsub = null;
  let pendingUnsub = null;

  navLogout?.addEventListener("click", async (e) => {
    e.preventDefault();
    await auth.signOut();
    window.location.href = "login.html";
  });

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    currentUser = user;
    userProfile = await loadProfile(user);
    isAdmin =
      (userProfile.role || "").toLowerCase() === "admin" ||
      userProfile.isAdmin === true;

    if (isAdmin && adminControls) {
      adminControls.style.display = "flex";
    }

    initAnnouncements();
    initLeaveRequests();
  });

  async function loadProfile(user) {
    const ref = db.collection("users").doc(user.uid);
    const snap = await ref.get();
    let data = {};
    if (snap.exists) {
      data = snap.data() || {};
    } else {
      data = {
        email: user.email || "",
        name: user.displayName || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await ref.set(data, { merge: true });
    }

    topName.textContent = data.name || user.email || "User";
    topEmail.textContent = data.email || user.email || "";
    if (data.profileImage) {
      topAvatar.src = data.profileImage;
    }

    // Profile card fields
    profileNameDisplay.textContent = data.name || user.email || "User";
    profileEmailDisplay.textContent = data.email || user.email || "";
    profileNameInput.value = data.name || "";
    profileJobInput.value = data.jobTitle || "";
    profilePhoneInput.value = data.phone || "";
    if (data.profileImage) {
      profileAvatar.src = data.profileImage;
    }

    saveProfileBtn?.addEventListener("click", () => saveProfile(ref, user));

    return data;
  }

  // ----- Profile update -----
  async function saveProfile(ref, user) {
    try {
      saveProfileBtn.disabled = true;
      const updated = {
        name: profileNameInput.value || "",
        jobTitle: profileJobInput.value || "",
        phone: profilePhoneInput.value || "",
        email: user.email,
      };

      if (profilePhoto.files && profilePhoto.files[0]) {
        const b64 = await fileToBase64(profilePhoto.files[0]);
        updated.profileImage = b64;
      }

      await ref.set(updated, { merge: true });

      topName.textContent = updated.name || user.email;
      profileNameDisplay.textContent = updated.name || user.email;
      profileEmailDisplay.textContent = user.email;
      profileJobInput.value = updated.jobTitle || "";
      profilePhoneInput.value = updated.phone || "";
      if (updated.profileImage) {
        topAvatar.src = updated.profileImage;
        profileAvatar.src = updated.profileImage;
      }

      alert("Profile saved.");
    } catch (err) {
      console.error(err);
      alert("Error saving profile: " + err.message);
    } finally {
      saveProfileBtn.disabled = false;
    }
  }

  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  // ----- Announcements -----
  function initAnnouncements() {
    if (isAdmin) {
      openComposer?.addEventListener("click", () => {
        composerWrap.style.display = "flex";
        announceTitle.focus();
      });
      cancelAnnouncement?.addEventListener("click", () => {
        composerWrap.style.display = "none";
        announceTitle.value = "";
        announceBody.value = "";
      });
      postAnnouncement?.addEventListener("click", postAnnouncementHandler);
    }

    if (annUnsub) annUnsub();
    annUnsub = db
      .collection("announcements")
      .orderBy("createdAt", "desc")
      .onSnapshot((snap) => {
        announcementsEl.innerHTML = "";
        if (snap.empty) {
          announcementsEl.innerHTML =
            '<div class="small-muted">No announcements yet.</div>';
          return;
        }
        snap.forEach((doc) => {
          announcementsEl.appendChild(renderAnnouncement(doc));
        });
      });
  }

  async function postAnnouncementHandler() {
    const title = announceTitle.value.trim();
    const body = announceBody.value.trim();
    if (!title || !body) {
      alert("Title and body are required.");
      return;
    }
    postAnnouncement.disabled = true;
    try {
      await db.collection("announcements").add({
        title,
        body,
        authorId: currentUser.uid,
        authorName: userProfile.name || currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        likes: [],
      });
      announceTitle.value = "";
      announceBody.value = "";
      composerWrap.style.display = "none";
    } catch (err) {
      console.error(err);
      alert("Could not post announcement: " + err.message);
    } finally {
      postAnnouncement.disabled = false;
    }
  }

  function renderAnnouncement(doc) {
    const data = doc.data();
    const liked =
      Array.isArray(data.likes) && currentUser
        ? data.likes.includes(currentUser.uid)
        : false;

    const card = document.createElement("div");
    card.className = "announcement";

    const meta = document.createElement("div");
    meta.className = "meta";
    const metaLeft = document.createElement("div");
    const postedBy = document.createElement("div");
    postedBy.className = "small-muted";
    postedBy.textContent = `Posted by ${data.authorName || "Someone"}`;
    const postedAt = document.createElement("div");
    postedAt.className = "small-muted";
    postedAt.textContent = formatDateTime(data.createdAt);
    metaLeft.append(postedBy, postedAt);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Announcement";
    meta.append(metaLeft, badge);

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = data.title || "Untitled";

    const body = document.createElement("div");
    body.className = "body";
    body.textContent = data.body || "";

    const actions = document.createElement("div");
    actions.className = "actions";
    const likeBtn = document.createElement("button");
    likeBtn.className = "icon-btn" + (liked ? " liked" : "");
    likeBtn.textContent = `${liked ? "Liked" : "Like"} · ${
      Array.isArray(data.likes) ? data.likes.length : 0
    }`;
    likeBtn.addEventListener("click", () =>
      toggleLike(doc.id, liked, data.likes || [])
    );

    actions.appendChild(likeBtn);
    card.append(meta, title, body, actions);
    return card;
  }

  async function toggleLike(id, liked, currentLikes) {
    try {
      await db
        .collection("announcements")
        .doc(id)
        .update({
          likes: liked
            ? firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
            : firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
        });
    } catch (err) {
      console.error(err);
      alert("Could not update like: " + err.message);
    }
  }

  // ----- Leave requests -----
  function initLeaveRequests() {
    submitLeaveBtn?.addEventListener("click", submitLeave);

    if (myReqUnsub) myReqUnsub();
    myReqUnsub = db
      .collection("leaveRequests")
      .where("userId", "==", currentUser.uid)
      .onSnapshot(
        (snap) => {
          yourRequestsEl.innerHTML = "";
          if (snap.empty) {
            yourRequestsEl.innerHTML =
              '<div class="small-muted">No requests yet.</div>';
            return;
          }
          const items = [];
          snap.forEach((doc) => items.push(doc.data()));
          items
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
            .forEach((data) => yourRequestsEl.appendChild(renderRequest(data, false)));
        },
        (err) => {
          console.error("Error loading your requests", err);
          yourRequestsEl.innerHTML =
            '<div class="small-muted">Could not load requests (check Firestore rules/indexes).</div>';
        }
      );

    if (isAdmin) {
      pendingWrap.style.display = "block";
      if (pendingUnsub) pendingUnsub();
      pendingUnsub = db
        .collection("leaveRequests")
        .where("status", "==", "pending")
        .onSnapshot(
          (snap) => {
            pendingEl.innerHTML = "";
            if (snap.empty) {
              pendingEl.innerHTML =
                '<div class="small-muted">Nothing waiting for you.</div>';
              return;
            }
            const items = [];
            snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
            items
              .sort(
                (a, b) =>
                  (b.createdAt?.toMillis?.() || 0) -
                  (a.createdAt?.toMillis?.() || 0)
              )
              .forEach((data) => {
                const card = renderRequest(data, true);
                const actions = document.createElement("div");
                actions.className = "actions";
                const approve = document.createElement("button");
                approve.className = "btn";
                approve.textContent = "Approve";
                approve.addEventListener("click", () =>
                  updateLeaveStatus(data.id, "approved")
                );
                const deny = document.createElement("button");
                deny.className = "btn-ghost";
                deny.textContent = "Deny";
                deny.addEventListener("click", () =>
                  updateLeaveStatus(data.id, "denied")
                );
                actions.append(approve, deny);
                card.appendChild(actions);
                pendingEl.appendChild(card);
              });
          },
          (err) => {
            console.error("Error loading pending approvals", err);
            pendingEl.innerHTML =
              '<div class="small-muted">Could not load pending approvals (check Firestore rules/indexes).</div>';
          }
        );
    }
  }

  async function submitLeave() {
    const type = leaveType.value;
    const fromDate = leaveFrom.value ? new Date(leaveFrom.value) : null;
    const toDate = leaveTo.value ? new Date(leaveTo.value) : null;
    const reason = leaveReason.value.trim();

    if (!fromDate || !toDate || !reason) {
      alert("Please fill in all leave request fields.");
      return;
    }
    if (fromDate > toDate) {
      alert("Start date cannot be after end date.");
      return;
    }

    submitLeaveBtn.disabled = true;
    try {
      await db.collection("leaveRequests").add({
        userId: currentUser.uid,
        userName: userProfile.name || currentUser.email,
        userEmail: currentUser.email,
        type,
        from: firebase.firestore.Timestamp.fromDate(fromDate),
        to: firebase.firestore.Timestamp.fromDate(toDate),
        reason,
        status: "pending",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      leaveReason.value = "";
      leaveFrom.value = "";
      leaveTo.value = "";
      leaveType.value = "annual";
    } catch (err) {
      console.error(err);
      alert("Could not submit request: " + err.message);
    } finally {
      submitLeaveBtn.disabled = false;
    }
  }

  async function updateLeaveStatus(id, status) {
    try {
      await db.collection("leaveRequests").doc(id).update({
        status,
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
        reviewerId: currentUser.uid,
      });
    } catch (err) {
      console.error(err);
      alert("Could not update request: " + err.message);
    }
  }

  function renderRequest(data, showUser) {
    const card = document.createElement("div");
    card.className = "req";

    const top = document.createElement("div");
    top.className = "row";
    const typeBadge = document.createElement("span");
    typeBadge.className = "badge";
    typeBadge.textContent = formatLabel(data.type);

    const status = document.createElement("span");
    status.className = `${statusClass(data.status)} pill`;
    status.textContent = (data.status || "pending").toUpperCase();
    top.append(typeBadge, status);

    const dates = document.createElement("div");
    dates.className = "small-muted";
    dates.textContent = `${formatDate(data.from)} → ${formatDate(data.to)}`;

    const reason = document.createElement("div");
    reason.textContent = data.reason || "";

    card.append(top);
    if (showUser) {
      const who = document.createElement("div");
      who.className = "small-muted";
      who.textContent = `${data.userName || "Employee"} • ${
        data.userEmail || ""
      }`;
      card.appendChild(who);
    }
    card.append(dates, reason);
    return card;
  }

  function statusClass(status) {
    if (status === "approved") return "status-approved";
    if (status === "denied") return "status-denied";
    return "status-pending";
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : ts;
    return d.toLocaleDateString();
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : ts;
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }

  function formatLabel(val) {
    if (!val) return "Leave";
    return val.charAt(0).toUpperCase() + val.slice(1);
  }
})();

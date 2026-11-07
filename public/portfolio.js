(() => {
  const roles = {
    student: {
      title: "Your support network, in one place.",
      description:
        "A first-year student can find their assigned mentor, start a conversation, and keep up with approved campus events.",
      cards: [
        [
          "Meet your mentor",
          "View an assigned mentor’s profile and available contact options.",
          "Mentor assignment",
        ],
        [
          "Make campus your own",
          "Browse the shared calendar and check in to eligible events using a QR link.",
          "Calendar & attendance",
        ],
        [
          "Keep the conversation going",
          "Read notices, receive notifications, and message an assigned mentor.",
          "Messages & updates",
        ],
      ],
      journey: [
        "Sign in",
        "Meet your mentor",
        "Join an event",
        "Stay connected",
      ],
    },
    mentor: {
      title: "Turn experience into guidance.",
      description:
        "An approved mentor can support assigned students, record contact, and propose activities for supervisor review.",
      cards: [
        [
          "Know your students",
          "Find assigned students and record mentor contact through the supported workflow.",
          "Assigned students & contact",
        ],
        [
          "Propose an event",
          "Submit an event request with a date, time, and purpose for supervisor review.",
          "Request → review → publication",
        ],
        [
          "Make yourself available",
          "Maintain a mentor profile, photo, and contact details, and reply to student messages.",
          "Profile & communication",
        ],
      ],
      journey: [
        "Get approved",
        "Meet assigned students",
        "Record contact",
        "Propose activities",
      ],
    },
    supervisor: {
      title: "Connect people. Guide the programme.",
      description:
        "A supervisor coordinates mentorship, reviews applications and event requests, and oversees participation.",
      cards: [
        [
          "Build the support network",
          "Review mentor applications and assign eligible students to approved mentors.",
          "Applications & assignments",
        ],
        [
          "Review campus activities",
          "Approve or reject requests and manage scheduled events through completion.",
          "Event lifecycle",
        ],
        [
          "Keep participation accountable",
          "Review attendance, record eligible manual check-ins with a reason, and follow contact alerts.",
          "Attendance & oversight",
        ],
      ],
      journey: [
        "Review applications",
        "Assign mentors",
        "Approve events",
        "Monitor participation",
      ],
    },
    admin: {
      title: "Give the community a solid foundation.",
      description:
        "An administrator manages the programme’s academic structure, account controls, announcements, and operational summaries.",
      cards: [
        [
          "Organise the academic structure",
          "Maintain faculties and programmes used by registration, profiles, and staff workflows.",
          "Academic catalogue",
        ],
        [
          "Manage account access",
          "Review account status and use the available controls for mentor profiles and activation.",
          "Account controls",
        ],
        [
          "Keep everyone informed",
          "Publish system notices and review programme analytics within the admin workspace.",
          "Notices & analytics",
        ],
      ],
      journey: [
        "Maintain catalogue",
        "Manage accounts",
        "Publish notices",
        "Review summaries",
      ],
    },
  };
  const buttons = document.querySelectorAll("[data-role]");
  const numbers = ["one", "two", "three"];
  buttons.forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.role;
      const role = roles[key];
      if (!role) return;
      buttons.forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
      document.querySelector("#role-label").textContent =
        `${key.toUpperCase()} WORKSPACE`;
      document.querySelector("#role-title").textContent = role.title;
      document.querySelector("#role-description").textContent =
        role.description;
      role.cards.forEach((card, index) => {
        ["title", "body", "status"].forEach((field, i) => {
          document.querySelector(
            `#card-${numbers[index]}-${field}`,
          ).textContent = card[i];
        });
      });
      const journey = document.querySelector("#role-journey");
      journey.replaceChildren();
      role.journey.forEach((step, index) => {
        if (index) {
          const arrow = document.createElement("b");
          arrow.textContent = "→";
          journey.append(arrow);
        }
        journey.append(document.createTextNode(step));
      });
    }),
  );
})();

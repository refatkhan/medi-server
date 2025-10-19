const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
app.use(cors());
app.use(express.json());
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6clk9e4.mongodb.net/mediCamp?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("campDB");
    const campsCollection = db.collection("camps");
    const campsJoinCollection = db.collection("campsJoin");
    const usersCollection = db.collection("users");
    const feedbacksCollection = db.collection("feedback");
    const participantCollection = db.collection("participants"); // Assuming this collection exists
    const SECRET_KEY = process.env.JWT_SECRET;

    // JWT Verify Middleware
    const verifyJWT = (req, res, next) => {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token)
        return res
          .status(401)
          .send({ message: "Unauthorized: No token provided" });

      jwt.verify(token, SECRET_KEY, (err, decoded) => {
        if (err)
          return res.status(403).send({ message: "Forbidden: Invalid token" });
        req.decoded = decoded;
        next();
      });
    };
    // Organizer Verify Middleware
    const verifyOrganizer = async (req, res, next) => {
      try {
        const email = req.decoded.email;
        if (!email) {
          return res
            .status(401)
            .send({ message: "Unauthorized: No email found" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        if (user.role !== "organizer") {
          return res
            .status(403)
            .send({ message: "Forbidden access: Not an organizer" });
        }

        // Attach user data to request object for further use in routes
        req.user = user;
        next();
      } catch (error) {
        console.error("Error in verifyOrganizer middleware:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    };
    // JWT Token API
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      const user = { email };
      const token = jwt.sign(user, SECRET_KEY, { expiresIn: "7d" });
      res.send({ token });
    });

    //==================all USERS API==================
    // Users info
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;
        if (!user?.email) {
          return res.status(400).json({ message: "Email is required" });
        }
        const usersCollection = db.collection("users");
        // Check if user already exists
        const existingUser = await usersCollection.findOne({
          email: user.email,
        });
        if (existingUser) {
          return res.status(409).json({ message: "User already exists" });
        }
        const result = await usersCollection.insertOne(user);
        res
          .status(201)
          .json({ message: "User added successfully", data: result });
      } catch (err) {
        console.error("Add User Error:", err);
        res
          .status(500)
          .json({ message: "Internal Server Error", error: err.message });
      }
    });
    //finding user info api using with user email
    app.get("/users/role/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.json(user); // send full user details
      } catch (error) {
        res.status(500).json({ message: error.message });
      }
    });

    //==============CAMPS & DASHBOARD RELATED=================
    // Organizer Dashboard API
    app.get(
      "/organizer-camps",
      verifyJWT,
      verifyOrganizer,
      async (req, res) => {
        const result = await campsCollection
          .find({ organizerEmail: req.query.email })
          .toArray();
        res.send(result);
      }
    );
    //add camps to dbms
    app.post("/camps", verifyJWT, verifyOrganizer, async (req, res) => {
      const campData = { ...req.body, participants: 0 };
      const result = await campsCollection.insertOne(campData);
      res.send(result);
    });
    //get camps
    app.get("/camps", async (req, res) => {
      const result = await campsCollection
        .find()
        .sort({ participants: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });
    //  check users join status
    app.get("/check-join-status", async (req, res) => {
      const { email, campId } = req.query;
      try {
        const existing = await campsJoinCollection.findOne({ email, campId });
        res.send({ joined: !!existing });
      } catch (error) {
        console.error("Error checking join status:", error);
        res.status(500).send({ joined: false });
      }
    });
    // available api
    app.get("/available-camps", async (req, res) => {
      const { search, sort } = req.query;

      const query = search
        ? {
            $or: [
              { campName: { $regex: search, $options: "i" } },
              { location: { $regex: search, $options: "i" } },
              { doctorName: { $regex: search, $options: "i" } },
            ],
          }
        : {};

      const sortMap = {
        "most-registered": { participants: -1 },
        "lowest-fee": { fees: 1 },
        "highest-fee": { fees: -1 },
      };

      const result = await campsCollection
        .find(query)
        .sort(sortMap[sort] || { campName: 1 })
        .toArray();

      res.send(result);
    });
    // Camp Registration API
    // Camp Registration API
    app.post("/camps-join", async (req, res) => {
      const data = req.body;
      const { email, campId } = data;
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const existing = await campsJoinCollection.findOne(
            { email, campId },
            { session }
          );

          if (existing) {
            throw new Error("You have already registered for this camp");
          }

          const registrationData = {
            ...data,
            status: "unpaid",
            confirmationStatus: "Pending",
            registeredAt: new Date(),
          };

          const result = await campsJoinCollection.insertOne(registrationData, {
            session,
          });

          const updateResult = await campsCollection.updateOne(
            { _id: new ObjectId(campId) },
            { $inc: { participants: 1 } },
            { session }
          );

          if (updateResult.matchedCount === 0) {
            throw new Error("Camp not found for participant count update");
          }

          res.send({
            success: true,
            insertedId: result.insertedId,
            message: "Registration successful",
          });
        });
      } catch (error) {
        if (
          error.message.includes("duplicate key") ||
          error.message.includes("already registered")
        ) {
          res.status(400).send({
            success: false,
            message: "You have already registered for this camp",
          });
        } else {
          console.error("Registration error:", error);
          res.status(500).send({
            success: false,
            message: error.message || "Registration failed",
          });
        }
      } finally {
        await session.endSession();
      }
    });

    // Registered Camps API
    app.get(
      "/registered-camps",
      verifyJWT,
      verifyOrganizer,
      async (req, res) => {
        try {
          const organizerEmail = req.query.email;

          // Step 1: Find all camps created by this organizer
          const organizerCamps = await campsCollection
            .find({ organizerEmail })
            .toArray();
          if (organizerCamps.length === 0) {
            return res.send([]); // No camps, so no registrations to manage
          }

          // Step 2: Get the IDs of these camps
          const campIds = organizerCamps.map((camp) => camp._id.toString());

          // Step 3: Find all registrations that match these camp IDs
          const registered = await campsJoinCollection
            .find({
              campId: { $in: campIds },
            })
            .toArray();

          // Step 4: Merge camp names into the registration records (your existing logic is good)
          const result = registered.map((record) => {
            const camp = organizerCamps.find(
              (c) => c._id.toString() === record.campId
            );
            return {
              ...record,
              fees: camp?.fees || 0, // Also add fees for display
              campName: camp?.campName || "Unknown Camp",
            };
          });

          res.send(result);
        } catch (error) {
          console.error(
            "Error fetching registered camps for organizer:",
            error
          );
          res.status(500).send({ message: "Failed to fetch registrations" });
        }
      }
    );

    //delete the camps
    app.delete(
      "/delete-camp/:id",
      verifyJWT,
      verifyOrganizer,
      async (req, res) => {
        const result = await campsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
        });
        res.send(result);
      }
    );
    // Update Camp API
    app.patch(
      "/update-camp/:id",
      verifyJWT,
      verifyOrganizer,
      async (req, res) => {
        const { _id, ...updateData } = req.body;
        const result = await campsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: updateData }
        );
        res.send(result);
      }
    );
    // Update Confirmation Status API
    app.patch("/update-confirmation/:id", async (req, res) => {
      const { confirmationStatus } = req.body;
      if (!confirmationStatus) {
        return res
          .status(400)
          .send({ error: "confirmationStatus is required" });
      }

      try {
        const result = await campsJoinCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { confirmationStatus: confirmationStatus } }
        );
        if (result.matchedCount === 0) {
          return res.status(404).send({ error: "Registration not found" });
        }
        res.send(result);
      } catch (error) {
        console.error("Error updating confirmation status:", error);
        res.status(500).send({ error: "Failed to update confirmation status" });
      }
    });
    app.get("/available-camps/:id", async (req, res) => {
      const result = await campsCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    //=======================participant==================
    // Profile API
    app.get("/participant-profile", async (req, res) => {
      const user = await usersCollection.findOne({ email: req.query.email });
      const registration = await campsJoinCollection.findOne({
        email: req.query.email,
      });
      res.send({
        name: user?.name,
        photoURL: user?.photoURL,
        contact: registration?.emergencyContact || "",
      });
    });

    // Participant Dashboard API
    app.get("/participant-analytics", async (req, res) => {
      const userEmail = req.query.email;
      // 1. Get registrations
      const registrations = await campsJoinCollection
        .find({ email: userEmail })
        .toArray();
      // 2. Fetch camp details for each registration
      const enrichedData = await Promise.all(
        registrations.map(async (reg) => {
          const camp = await campsCollection.findOne({
            _id: new ObjectId(reg.campId),
          });
          return {
            ...reg,
            campName: camp?.campName || "N/A",
            fees: camp?.fees || 0,
            location: camp?.location || "N/A",
            doctorName: camp?.doctorName || "N/A",
          };
        })
      );
      res.send(enrichedData);
    });
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || "user" });
    });

    //update profile users
   app.patch("/update-profile", verifyJWT, async (req, res) => {
    // Security check: Only allow users to update their own profile
    if (req.decoded.email !== req.body.email) {
        return res.status(403).send({ message: "Forbidden: You can only update your own profile." });
    }

    const { email, name, photoURL, contact } = req.body;
    
    // Construct the fields to be updated in the 'users' collection
    const updateFields = {
        updatedAt: new Date() // Always update the timestamp
    };
    if (name) updateFields.name = name;
    if (photoURL) updateFields.photoURL = photoURL;
    // This will add or update the contact field
    if (contact !== undefined) updateFields.contact = contact; 

    try {
        const result = await usersCollection.updateOne(
            { email: email },
            { $set: updateFields },
            { upsert: false } // We don't want to create a user here, only update
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ error: "User not found" });
        }

        res.send({ success: true, message: "Profile updated in database" });

    } catch (error) {
        console.error("Error updating profile in DB:", error);
        res.status(500).send({ error: "Failed to update profile in database" });
    }
});
    ///payments
    app.get("/user-registered-camps", async (req, res) => {
      const userEmail = req.query.email;

      // 1. Get user registrations
      const registrations = await campsJoinCollection
        .find({ email: userEmail })
        .toArray();

      // 2. Fetch camp details for each registration
      const enrichedData = await Promise.all(
        registrations.map(async (reg) => {
          const camp = await campsCollection.findOne({
            _id: new ObjectId(reg.campId),
          });
          return {
            _id: reg._id,
            campId: reg.campId,
            campName: camp?.campName || "Unknown Camp",
            fees: camp?.fees || 0,
            location: camp?.location || "Unknown Location",
            doctorName: camp?.doctorName || "Unknown Doctor",
            status: reg.status || "unpaid",
            confirmationStatus: reg.confirmationStatus || "Pending",
          };
        })
      );

      res.send(enrichedData);
    });

    // Payment API
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: "usd",
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.patch("/update-payment-status/:id", async (req, res) => {
      const { status, transactionId } = req.body;
      const result = await campsJoinCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status, transactionId } }
      );
      res.send(result);
    });

    // Payment History API
    app.get("/payment-history", async (req, res) => {
      const { email } = req.query;
      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }

      try {
        const paymentHistory = await campsJoinCollection
          .find({
            email,
            status: { $regex: /^paid$/i }, // Case-insensitive match for "paid"
          })
          .toArray();
        if (paymentHistory.length === 0) {
          return res.status(404).send({ error: "No payment history found" });
        }
        res.send(paymentHistory);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch payment history" });
      }
    });
    app.delete("/cancel-registration/:id", async (req, res) => {
      const registration = await campsJoinCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      if (!registration) {
        return res.status(404).send({ message: "Registration not found" });
      }
      if (registration.status === "paid") {
        return res
          .status(400)
          .send({ message: "Cannot cancel paid registration" });
      }
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          // Delete registration
          await campsJoinCollection.deleteOne(
            { _id: new ObjectId(req.params.id) },
            { session }
          );
          // Decrement participant count
          await campsCollection.updateOne(
            { _id: new ObjectId(registration.campId) },
            { $inc: { participants: -1 } },
            { session }
          );
        });
        res.send({ success: true });
      } finally {
        await session.endSession();
      }
    });

    //feedback
    // Feedback API
    app.post("/submit-feedback", async (req, res) => {
      const feedback = {
        ...req.body,
        submittedAt: new Date(),
      };
      const result = await feedbacksCollection.insertOne(feedback);
      res.send(result);
    });

    app.get("/feedbacks", async (req, res) => {
      const result = await feedbacksCollection.find().toArray();
      res.send(result);
    });
    // ================== ORGANIZER OVERVIEW STATS API ==================
    app.get(
      "/organizer-stats",
      verifyJWT,
      verifyOrganizer,
      async (req, res) => {
        try {
          // 1. Total Camps, Participants, and Upcoming Camps
          const campStats = await campsCollection
            .aggregate([
              {
                $group: {
                  _id: null,
                  totalCamps: { $sum: 1 },
                  totalParticipants: { $sum: "$participants" },
                  upcomingCamps: {
                    $sum: {
                      $cond: [
                        { $gt: ["$dateTime", new Date().toISOString()] },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ])
            .toArray();

          // 2. Total Revenue (from paid registrations)
          const revenueStats = await campsJoinCollection
            .aggregate([
              { $match: { status: "paid" } },
              // We need to look up the fee from the camps collection
              {
                $lookup: {
                  from: "camps",
                  // Important: Convert string campId to ObjectId for matching
                  let: { camp_id: { $toObjectId: "$campId" } },
                  pipeline: [
                    { $match: { $expr: { $eq: ["$_id", "$$camp_id"] } } },
                  ],
                  as: "campDetails",
                },
              },
              { $unwind: "$campDetails" },
              {
                $group: {
                  _id: null,
                  totalRevenue: { $sum: "$campDetails.fees" },
                },
              },
            ])
            .toArray();

          // 3. Registrations over the last 6 months
          const sixMonthsAgo = new Date();
          sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

          const registrationsOverTime = await campsJoinCollection
            .aggregate([
              { $match: { registeredAt: { $gte: sixMonthsAgo } } },
              {
                $group: {
                  _id: {
                    year: { $year: "$registeredAt" },
                    month: { $month: "$registeredAt" },
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { "_id.year": 1, "_id.month": 1 } },
              {
                $project: {
                  _id: 0,
                  month: {
                    // Convert month number to name (e.g., 1 -> "Jan")
                    $let: {
                      vars: {
                        monthsInYear: [
                          "",
                          "Jan",
                          "Feb",
                          "Mar",
                          "Apr",
                          "May",
                          "Jun",
                          "Jul",
                          "Aug",
                          "Sep",
                          "Oct",
                          "Nov",
                          "Dec",
                        ],
                      },
                      in: { $arrayElemAt: ["$$monthsInYear", "$_id.month"] },
                    },
                  },
                  count: 1,
                },
              },
            ])
            .toArray();

          // 4. Camps by Location
          const campsByLocation = await campsCollection
            .aggregate([
              {
                $group: {
                  _id: "$location",
                  count: { $sum: 1 },
                },
              },
              {
                $project: {
                  _id: 0,
                  location: "$_id",
                  count: 1,
                },
              },
            ])
            .toArray();

          // 5. Recent Registrations
          const recentRegistrations = await campsJoinCollection
            .find()
            .sort({ registeredAt: -1 })
            .limit(5)
            .toArray();

          // Consolidate all stats into one response object
          const stats = {
            totalCamps: campStats[0]?.totalCamps || 0,
            totalParticipants: campStats[0]?.totalParticipants || 0,
            upcomingCampsCount: campStats[0]?.upcomingCamps || 0,
            totalRevenue: revenueStats[0]?.totalRevenue || 0,
            registrationsOverTime,
            campsByLocation,
            recentRegistrations,
          };

          res.send(stats);
        } catch (error) {
          console.error("Error fetching organizer stats:", error);
          res.status(500).send({ message: "Failed to fetch stats" });
        }
      }
    );
    // Connect the client to the server	(optional starting in v4.7)
    app.get("/", (req, res) => {
      res.send("🚑 Medical Camp API is running!");
    });

    // Send a ping to confirm a successful connection
  } finally {
  }
}
run().catch(console.dir);

// 🚨 For Vercel: DO NOT use app.listen()
// Instead, export the app
module.exports = app;

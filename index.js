const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT || 3000;

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
    // Registered Camps API
    app.get("/registered-camps", async (req, res) => {
      const result = await campsJoinCollection
        .find({ organizerEmail: req.query.email })
        .toArray();
      res.send(result);
    });
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

    //updated related
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
        console.log("Update Confirmation Result:", result); // Debug log
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
      const result = await campsJoinCollection
        .find({ email: req.query.email })
        .toArray();
      res.send(result);
    });
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

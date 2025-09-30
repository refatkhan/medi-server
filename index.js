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
    app.get("/", (req, res) => {
      res.send("Server is running!");
    });
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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
